const socket = io();
let myRoom, count = 0, stage = 'up', gameActive = false, timeLeft = 60;

const benefits = {
    'pushup': 'วิดพื้น: ช่วยปั้นกล้ามอกและแขนให้แข็งแรง! <i data-lucide="dumbbell" class="icon-sm" style="color: var(--accent-secondary);"></i>',
    'squat': 'ลุกนั่ง: ช่วยให้ขาเฟิร์ม ก้นกระชับ! <i data-lucide="activity" class="icon-sm" style="color: var(--accent-secondary);"></i>',
    'jumping_jack': 'กระโดดตบ: เบิร์นไขมันและหัวใจแข็งแรง! <i data-lucide="heart-pulse" class="icon-sm" style="color: var(--danger);"></i>'
};

function updateBlue() {
    const ex = document.getElementById('exercise_type').value;
    document.getElementById('setup-blue-message').innerHTML = `<strong style="font-size: 16px;">${benefits[ex]}</strong><br><br>อย่าลืมยืนในที่สว่างๆ นะครับ <i data-lucide="lightbulb" class="icon-sm" style="color: var(--warning);"></i>`;
    lucide.createIcons();
}

function startApp() {
    myRoom = document.getElementById('room_id').value;
    if(!myRoom) {
        alert("กรุณาใส่เลขห้อง หรือกดปุ่ม Global ครับ");
        return;
    }
    socket.emit('join', { room: myRoom, exercise: document.getElementById('exercise_type').value });
}

socket.on('update_players', data => {
    document.getElementById('setup').style.display = 'none';
    document.getElementById('main-app').style.display = 'grid';
    
    const list = document.getElementById('player_list');
    list.innerHTML = "";
    
    const players = Object.entries(data.players);
    
    players.forEach(([name, p]) => {
        const isMe = (name === currentUsername) ? ` <i data-lucide="user" class="icon-sm"></i>` : "";
        const readyStatus = p.ready ? '<i data-lucide="check-circle" class="icon-sm"></i> พร้อม' : '<i data-lucide="hourglass" class="icon-sm"></i> รอ';
        
        const playerDiv = document.createElement('div');
        playerDiv.className = 'player-item';
        playerDiv.style.background = p.ready ? "rgba(46, 204, 113, 0.15)" : "rgba(52, 152, 219, 0.1)";
        playerDiv.style.borderLeftColor = p.ready ? "#2ecc71" : "#3498db";
        
        playerDiv.innerHTML = `
            <span class="player-name" style="display: flex; align-items: center;">${name}${isMe}</span>
            <div style="display: flex; gap: 10px; align-items: center;">
                <span class="player-score">${p.score}</span>
                <span style="font-size: 13px; font-weight: 500; display: flex; align-items: center; color: ${p.ready ? '#2ecc71' : '#f39c12'};">${readyStatus}</span>
            </div>
        `;
        list.appendChild(playerDiv);
    });
    lucide.createIcons();
});

function sendReady() { 
    socket.emit('player_ready', { room: myRoom });
}

socket.on('start_countdown', () => {
    let c = 3;
    const ov = document.getElementById('countdown-overlay');
    ov.style.display = 'block';
    const itv = setInterval(() => {
        ov.innerText = c;
        if(c-- <= 0) { 
            clearInterval(itv); 
            ov.style.display='none'; 
            runGame(); 
        }
    }, 1000);
});

function runGame() {
    gameActive = true; 
    count = 0; 
    timeLeft = 60; 
    initAI();
    const tItv = setInterval(() => {
        const timerEl = document.getElementById('game_timer');
        timerEl.innerHTML = `<span style="display: flex; align-items: center;"><i data-lucide="timer" class="icon" style="margin-right: 6px;"></i> เวลาที่เหลือ</span> <span style="font-weight: 700;">${--timeLeft}s</span>`;
        lucide.createIcons();
        
        // Change color as time runs low
        if(timeLeft <= 10) {
            timerEl.style.color = '#e74c3c';
        } else if(timeLeft <= 30) {
            timerEl.style.color = '#f39c12';
        }
        
        if(timeLeft <= 0) { 
            clearInterval(tItv); 
            gameActive = false; 
            socket.emit('save_final_score', { type: document.getElementById('exercise_type').value, score: count });
            showResult();
        }
    }, 1000);
}

function showResult() {
    document.getElementById('final_list').innerHTML = document.getElementById('player_list').innerHTML;
    document.getElementById('result-modal').style.display = 'flex';
}

function initAI() {
    const video = document.getElementById('input_video');
    const canvas = document.getElementById('output_canvas');
    const ctx = canvas.getContext('2d');
    const pose = new Pose({locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${f}`});
    pose.setOptions({ modelComplexity: 1, minDetectionConfidence: 0.6 });
    pose.onResults(res => {
        canvas.width = video.videoWidth; 
        canvas.height = video.videoHeight;
        ctx.drawImage(res.image, 0, 0, canvas.width, canvas.height);
        if(res.poseLandmarks && gameActive) {
            const l = res.poseLandmarks;
            const ex = document.getElementById('exercise_type').value;
            if(ex === 'pushup') check(calc(l[11], l[13], l[15]), 160, 90);
            else if(ex === 'squat') check(calc(l[23], l[25], l[27]), 160, 100);
            else if(ex === 'jumping_jack') {
                const d = Math.sqrt(Math.pow(l[15].x-l[16].x,2)+Math.pow(l[15].y-l[16].y,2));
                if(d > 0.5) stage = 'down'; 
                if(d < 0.25 && stage === 'down') { 
                    stage = 'up'; 
                    upScore(); 
                }
            }
            drawConnectors(ctx, l, POSE_CONNECTIONS, {color: '#2ecc71', lineWidth: 2});
        }
    });
    new Camera(video, {
        onFrame: async() => await pose.send({image: video}), 
        width: 640, 
        height: 480
    }).start();
}

function check(a, u, d) { 
    if(a > u) stage = 'up'; 
    if(a < d && stage === 'up') { 
        stage = 'down'; 
        upScore(); 
    } 
}

function upScore() { 
    count++; 
    document.getElementById('my_counter').innerText = count; 
    socket.emit('update_score', {room: myRoom, score: count}); 
}

function calc(p1, p2, p3) {
    let a = Math.abs((Math.atan2(p3.y-p2.y, p3.x-p2.x) - Math.atan2(p1.y-p2.y, p1.x-p2.x)) * 180 / Math.PI);
    return a > 180 ? 360 - a : a;
}

// ฟังก์ชันออกจากห้อง
function leaveRoom() {
    if (confirm("คุณต้องการออกจากห้องแข่งขันใช่หรือไม่?")) {
        socket.emit('leave_room_manual', { room: myRoom });
        location.reload(); // รีเฟรชหน้าเว็บเพื่อกลับไปหน้า Setup
    }
}

// รับการแจ้งเตือนกรณีคนไม่พอ
socket.on('waiting_for_opponent', function(data) {
    alert(data.msg);
});

// ฟังก์ชันสำหรับเข้าห้อง Global
function joinGlobal() {
    const globalRoomName = "GLOBAL_ARENA_888";
    const selectedEx = document.getElementById('exercise_type').value;
    
    myRoom = globalRoomName;
    
    socket.emit('join', { 
        room: globalRoomName, 
        exercise: selectedEx 
    });
}