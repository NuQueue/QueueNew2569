const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: { origin: "*" }
});

app.use(express.static('public'));

const TYPES = { car: { prefix: 'A' }, Motorcycle: { prefix: 'B' }, tta: { prefix: 'C' } };

let queueDB = {
  queueData: { car: [], Motorcycle: [], tta: [] },
  counters: { car: 0, Motorcycle: 0, tta: 0 },
  plateHistory: {},
  activeCalls: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null, 8: null, 9: null, 10: null },
  recent: [],
  states: { car: { speed: 0.9, soundOn: true }, Motorcycle: { speed: 0.9, soundOn: true }, tta: { speed: 0.9, soundOn: true } }
};

let callingLock = false;

io.on('connection', (socket) => {
  console.log('เครื่องต่อเข้ามา:', socket.id);
  socket.emit('init_state', queueDB);

  socket.on('call_next', ({ counter, room }) => {
    if (callingLock) {
      socket.emit('call_failed', 'มีคนกดเรียกคิวอยู่');
      return;
    }
    callingLock = true;
    const nextItem = queueDB.queueData[room].find(q => !q.called);
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
    if (queueDB.recent.length > 10) queueDB.recent.pop();
    
    io.emit('update_state', queueDB);
    io.emit('announce_call', currentCall);
    callingLock = false;
  });

  socket.on('add_queue', ({ room, plate }) => {
    const today = new Date().toISOString().split('T')[0];
    if (!queueDB.plateHistory[today]) queueDB.plateHistory[today] = [];
    if (queueDB.plateHistory[today].includes(plate)) {
      socket.emit('add_failed', 'ทะเบียนนี้กดคิวไปแล้ววันนี้');
      return;
    }
    queueDB.counters[room]++;
    const ticket = TYPES[room].prefix + String(queueDB.counters[room]).padStart(3, '0');
    const newItem = { queue: ticket, plate: plate.toUpperCase(), called: false, createdAt: new Date().toISOString() };
    queueDB.queueData[room].push(newItem);
    queueDB.plateHistory[today].push(plate);
    io.emit('update_state', queueDB);
    socket.emit('add_success', newItem);
  });

  socket.on('reset_all', () => {
    queueDB = {
      queueData: { car: [], Motorcycle: [], tta: [] },
      counters: { car: 0, Motorcycle: 0, tta: 0 },
      plateHistory: {},
      activeCalls: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null, 7: null, 8: null, 9: null, 10: null },
      recent: [],
      states: { car: { speed: 0.9, soundOn: true }, Motorcycle: { speed: 0.9, soundOn: true }, tta: { speed: 0.9, soundOn: true } }
    };
    io.emit('update_state', queueDB);
  });
});

// เพิ่ม route หน้าแรก
app.get('/', (req, res) => {
  res.send(`
    <h2>Sadao Customs Queue System - Online</h2>
    <p>ระบบพร้อมใช้งาน:</p>
    <ul>
      <li><a href="/QueueDisplaySadao_v2.html">จอแสดงคิว</a></li>
      <li><a href="/SadaoCustomsQueue2569_v2.html">จอกดคิว</a></li>
    </ul>
  `);
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
