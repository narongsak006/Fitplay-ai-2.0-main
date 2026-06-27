from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user
from werkzeug.security import generate_password_hash, check_password_hash
from flask_socketio import SocketIO, emit, join_room, leave_room
from sqlalchemy import func
from datetime import datetime, timedelta
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = 'fitplay_secret_key_2026'
app.config['SQLALCHEMY_DATABASE_URI'] = 'mysql+mysqlconnector://root:@localhost/fitplay_db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# --- Database Models ---
class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)

class Score(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    exercise_type = db.Column(db.String(20), nullable=False)
    count = db.Column(db.Integer, default=0)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    user = db.relationship('User', backref='scores')

# --- Login Manager ---
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# --- Routes ---
@app.route('/')
def landing():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    return render_template('showcase.html')

@app.route('/home')
@login_required
def index():
    return render_template('index.html', username=current_user.username)    

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        user = User.query.filter_by(username=request.form['username']).first()
        if user and check_password_hash(user.password, request.form['password']):
            login_user(user)
            return redirect(url_for('index'))
        flash('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        confirm_pw = request.form['confirm_password']
        
        if password != confirm_pw:
            flash('รหัสผ่านไม่ตรงกัน!')
            return redirect(url_for('register'))
            
        hashed_pw = generate_password_hash(password, method='pbkdf2:sha256')
        new_user = User(username=username, password=hashed_pw)
        try:
            db.session.add(new_user)
            db.session.commit()
            flash('สมัครสำเร็จ! กรุณาล็อกอิน')
            return redirect(url_for('login'))
        except:
            db.session.rollback()
            flash('ชื่อนี้ถูกใช้ไปแล้ว')
    return render_template('register.html')

@app.route('/leaderboard')
@login_required
def leaderboard():
    # หาค่าวันแรกของสัปดาห์ (วันจันทร์)
    now = datetime.now()
    start_of_week = now - timedelta(days=now.weekday())
    start_of_week = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0)

    # รวมคะแนน SUM(count) รายบุคคล เฉพาะสัปดาห์นี้
    weekly_scores = db.session.query(
        User.username,
        func.sum(Score.count).label('total_count')
    ).join(User, Score.user_id == User.id)\
     .filter(Score.timestamp >= start_of_week)\
     .group_by(User.id)\
     .order_by(func.sum(Score.count).desc())\
     .limit(10).all()

    return render_template('leaderboard.html', scores=weekly_scores)

@app.route('/logout')
def logout():
    logout_user()
    return redirect(url_for('login'))

# --- Socket Events ---
rooms = {}

@socketio.on('join')
def on_join(data):
    room = data['room']
    ex = data['exercise']
    join_room(room)
    if room not in rooms:
        rooms[room] = {'exercise': ex, 'players': {}}
    rooms[room]['players'][current_user.username] = {'score': 0, 'ready': False}
    emit('update_players', rooms[room], to=room)

@socketio.on('player_ready')
def on_ready(data):
    room = data['room']
    user = current_user.username
    if room in rooms and user in rooms[room]['players']:
        rooms[room]['players'][user]['ready'] = True
        emit('update_players', rooms[room], to=room)
        
        ps = rooms[room]['players']
        # ต้องมี 2 คนขึ้นไป ถึงจะเริ่มนับถอยหลัง
        if len(ps) >= 2 and all(p['ready'] for p in ps.values()):
            emit('start_countdown', to=room)
        elif len(ps) < 2 and all(p['ready'] for p in ps.values()):
            emit('waiting_for_opponent', {'msg': 'ต้องการผู้เล่นอย่างน้อย 2 คนเพื่อเริ่มเกม'}, to=room)

@socketio.on('update_score')
def on_score(data):
    room = data['room']
    if room in rooms:
        rooms[room]['players'][current_user.username]['score'] = data['score']
        emit('update_players', rooms[room], to=room)

@socketio.on('save_final_score')
def on_save(data):
    ex = data['type']
    score_val = data['score']
    # บันทึกคะแนนใหม่ทุกครั้งเพื่อนำไป SUM ใน Leaderboard
    new_score = Score(user_id=current_user.id, exercise_type=ex, count=score_val)
    db.session.add(new_score)
    db.session.commit()

@socketio.on('leave_room_manual')
def on_leave(data):
    room = data['room']
    user = current_user.username
    if room in rooms and user in rooms[room]['players']:
        del rooms[room]['players'][user]
        leave_room(room)
        if not rooms[room]['players']:
            del rooms[room]
        else:
            emit('update_players', rooms[room], to=room)

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    socketio.run(app, debug=True, allow_unsafe_werkzeug=True)