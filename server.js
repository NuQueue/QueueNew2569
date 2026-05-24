const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*" }
});
const fs = require('fs');
const https = require('https');
const DB_FILE = './db.json';

app.use(express.static('public'));

const TYPES = { car: { prefix: 'A' }, Motorcycle: { prefix: 'B' }, tta: { prefix: 'C' } };

let queueDB;
try {
  queueDB = JSON.parse(fs.readFileSync(DB_FILE));
  console.log('โหลดคิวจาก./db.json สำเร็จ');
} catch (e) {
  queueDB = {
    queueData: { car: [], Motorcycle: [], tta: [] },
    counters: { car: 0, Motorcycle: 0, tta: 0 },
    plateHistory: {},
    activeCalls: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null, 8: null, 9: null, 10: null },
    recent: [],
    states: { 
      car: { speed: 0.9, soundOn: true, voiceType: 'auto' }, 
      Motorcycle: { speed: 0.9, soundOn: true, voiceType: 'auto' }, 
      tta: { speed: 0.9, soundOn: true, voiceType: 'auto' } 
    }
  };
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(queueDB));
    console.log('เซฟ DB สำเร็จ');
  } catch (err) {
    console.log('เซฟไม่สำเร็จ:', err.message);
  }
}

let callingLock = false;

io.on('connection', (socket) => {
  console.log('เครื่องต่อเข้ามา:', socket.id);
  socket.emit('init_state', queueDB);

  socket.on('call_next', ({ counter, room }) => {
    if (callingLock) {
      socket.emit('call_failed', 'รอเสียงอ่านจบก่อน');
      return;
    }
    callingLock = true;
    const nextItem = queueDB.queueData[room].find(q =>!q.called);
    if (!nextItem) {
      callingLock = false;
      socket.emit('call_failed', 'ไม่มีคิวรอ');
      return;
    }
    nextItem.called = true;
    nextItem.counter = counter;
    nextItem.calledAt = new Date().toISOString();
    const currentCall = { ticket: nextItem.queue, plate: nextItem.plate || "-", counter: counter, type: room };
    queueDB.activeCalls[counter] = currentCall;
    queueDB.recent.unshift(currentCall);
    if (queueDB.recent.length > 20) queueDB.recent.pop();
    io.emit('update_state', queueDB);
    saveDB();
    console.log(`Counter ${counter} เรียก ${currentCall.ticket}`);

    setTimeout(() => {
      if (callingLock) {
        callingLock = false;
        console.log('ปลดล็อคอัตโนมัติหลัง 15 วิ - กันค้าง');
      }
    }, 15000);
  });

  socket.on('speak_finished', () => {
    callingLock = false;
    console.log('ปลดล็อค: อ่านจบแล้ว');
  });

  socket.on('set_speed', ({ room, speed }) => {
    console.log('รับ set_speed:', room, speed);
    if (queueDB.states[room] && typeof speed === 'number') {
      queueDB.states[room].speed = speed;
      saveDB();
      io.emit('update_state', queueDB);
      console.log(`อัพเดท Speed: ${room} = ${speed}`);
    }
  });

  socket.on('set_voice', ({ room, voiceType }) => {
    console.log('รับ set_voice:', room, voiceType);
    if (queueDB.states[room]) {
      queueDB.states[room].voiceType = voiceType;
      saveDB();
      io.emit('update_state', queueDB);
      console.log(`อัพเดท Voice: ${room} = ${voiceType}`);
    }
  });

  socket.on('set_sound', ({ room, soundOn }) => {
    if (queueDB.states[room]) {
      queueDB.states[room].soundOn = soundOn;
      saveDB();
      io.emit('update_state', queueDB);
    }
  });

  socket.on('add_queue', ({ room, plate }) => {
    if (!['car','Motorcycle','tta'].includes(room)) return;

    const plateUpper = plate? plate.toUpperCase().trim() : "";
    if (!plateUpper) {
      socket.emit('call_failed', 'กรุณากรอกเลขทะเบียน');
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    if (!queueDB.plateHistory[today]) queueDB.plateHistory[today] = [];
    if (queueDB.plateHistory[today].includes(plateUpper)) {
      socket.emit('call_failed', `ทะเบียน ${plateUpper} ออกคิวไปแล้ววันนี้`);
      console.log('ทะเบียนซ้ำ:', plateUpper);
      return;
    }

    queueDB.counters[room]++;
    const newQueue = {
      queue: TYPES[room].prefix + String(queueDB.counters[room]).padStart(4, '0'),
      plate: plateUpper,
      type: room,
      called: false,
      counter: null,
      time: new Date().toISOString(),
      calledAt: null
    };
    queueDB.queueData[room].push(newQueue);
    queueDB.plateHistory[today].push(plateUpper);
    io.emit('update_state', queueDB);
    saveDB();
    socket.emit('queue_added_success', newQueue);
    console.log('ออกคิวใหม่:', newQueue.queue, newQueue.type, plateUpper);
  });

  socket.on('reset_all', () => {
    queueDB = {
      queueData: { car: [], Motorcycle: [], tta: [] },
      counters: { car: 0, Motorcycle: 0, tta: 0 },
      plateHistory: {},
      activeCalls: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null, 8: null, 9: null, 10: null },
      recent: [],
      states: queueDB.states
    };
    io.emit('update_state', queueDB);
    saveDB();
    console.log('Reset ระบบทั้งหมด');
  });

  socket.on('edit_queue', ({ oldQueue, newPlate }) => {
    const today = new Date().toISOString().slice(0, 10);
    let found = false;
    const newPlateUpper = newPlate.toUpperCase().trim();

    if (!newPlateUpper) {
      socket.emit('call_failed', 'ทะเบียนห้ามว่าง');
      return;
    }
    if (!/^[A-Z0-9]+$/.test(newPlateUpper)) {
      socket.emit('call_failed', 'ใช้ได้เฉพาะ A-Z, 0-9 เท่านั้น');
      return;
    }

    for (const room of ['car','Motorcycle','tta']) {
      const idx = queueDB.queueData[room].findIndex(q => q.queue === oldQueue);
      if (idx!== -1) {
        found = true;
        const oldPlate = queueDB.queueData[room][idx].plate;

        if (newPlateUpper!== oldPlate && queueDB.plateHistory[today]?.includes(newPlateUpper)) {
          socket.emit('call_failed', `ทะเบียน ${newPlateUpper} มีในระบบแล้ว`);
          return;
        }

        queueDB.queueData[room][idx].plate = newPlateUpper;

        if (queueDB.plateHistory[today]) {
          const oldIdx = queueDB.plateHistory[today].indexOf(oldPlate);
          if (oldIdx!== -1) queueDB.plateHistory[today].splice(oldIdx, 1);
          if (!queueDB.plateHistory[today].includes(newPlateUpper)) {
            queueDB.plateHistory[today].push(newPlateUpper);
          }
        }
        break;
      }
    }

    if (found) {
      io.emit('update_state', queueDB);
      saveDB();
      console.log(`แก้คิว ${oldQueue} เป็นทะเบียน ${newPlateUpper}`);
    } else {
      socket.emit('call_failed', 'ไม่พบคิวที่ต้องการแก้');
    }
  });

  socket.on('delete_queue', ({ queue }) => {
    let found = false;
    const today = new Date().toISOString().slice(0, 10);

    ['car','Motorcycle','tta'].forEach(room => {
      const idx = queueDB.queueData[room].findIndex(q => q.queue === queue);
      if (idx!== -1) {
        found = true;
        const deletedPlate = queueDB.queueData[room][idx].plate;
        queueDB.queueData[room].splice(idx, 1);

        if (queueDB.plateHistory[today]) {
          const pIdx = queueDB.plateHistory[today].indexOf(deletedPlate);
          if (pIdx!== -1) queueDB.plateHistory[today].splice(pIdx, 1);
        }
      }
    });

    if (found) {
      io.emit('update_state', queueDB);
      saveDB();
      console.log(`ลบคิว ${queue}`);
    } else {
      socket.emit('call_failed', 'ไม่พบคิวที่ต้องการลบ');
    }
  });

  socket.on('disconnect', () => console.log('เครื่องหลุด:', socket.id));
});

const SELF_URL = 'https://queuenew2569.onrender.com';
setInterval(() => {
  https.get(SELF_URL, (res) => {
    console.log(`Keep-alive ping: ${res.statusCode}`);
  }).on('error', (err) => {
    console.log('Keep-alive error:', err.message);
  });
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
