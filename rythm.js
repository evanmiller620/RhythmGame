// Game constants
const PLAYBACKBUTTON = document.getElementById('playback-btn');
const LOADINPUT = document.getElementById('load-input');
const RECORD = document.getElementById('record-btn');
const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 800;
const NOTE_SPEED = 12;
const JUDGMENT_LINE_Y = CANVAS_HEIGHT - 70;
const LINE_GAP = 50;

const PERFECT_THRESHOLD = 30;
const GOOD_THRESHOLD = 150;
const LANE_WIDTH = 100;
const LANE_START_X = 250;
const NOTE_WIDTH = 100;

// Game variables
var key_map = ['KeyA', 'KeyS', 'KeyK', 'KeyL'];
let canvas, ctx;
let notes = [];
let score = 0;
let combo = 0;
var text = "";
let audioContext;
let audioBuffer;
let audioSource;
let gameStartTime;
let isRecording = false;
let isPlayback = false;
let recordedKeys = [];
let power = [];
let scores = [];
let targetButton = null;

// Initialize the game
function init() {
    try {
        const canvas = document.getElementById('canvas');
        canvas.remove();
    } catch (e) {
        console.log(e);
    }
    canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    canvas.id = 'canvas';
    power = [false, false, false, false];
    canvas.style.backgroundColor = "black";
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');

    document.addEventListener('keyup', handleKeyRelease);
    
    scores = [0,0,0];

    gameStartTime = Date.now();
    updateScoreboard();
    if(isRecording) {
        requestAnimationFrame(recordLoop);
    }
    else {
        requestAnimationFrame(gameLoop);
    }
}


// Main game loop
function gameLoop() {
    // Clear the canvas
    ctx.clearRect(LANE_START_X, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const currentTime = Date.now() - gameStartTime;
    if (!isRecording && recordedKeys.length > 0 && currentTime >= recordedKeys[0].time) {
        // Generate new notes
        generateNotes(recordedKeys[0].key);
        recordedKeys.shift();
    }

    // Update and draw notes
    notes.forEach((note, index) => {
        note.y += NOTE_SPEED;
        if (note.y > CANVAS_HEIGHT + NOTE_WIDTH) {
            notes.splice(index, 1);
            combo = 0;
            scores[2]++;
            updateScoreboard('Miss!');
        } else {
            ctx.fillStyle = ['red', 'blue', 'green', 'yellow'][note.lane];
            ctx.fillRect(note.x, note.y-NOTE_WIDTH/2, LANE_WIDTH, 100);
        }
    });

    // Draw lane separators
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(LANE_START_X + i * LANE_WIDTH, 0);
        ctx.lineTo(LANE_START_X + i * LANE_WIDTH, JUDGMENT_LINE_Y + LINE_GAP + 3);
        ctx.stroke();
    }
    
    // Draw judgment line
    ctx.fillStyle = 'white';
    ctx.fillRect(LANE_START_X, JUDGMENT_LINE_Y + LINE_GAP, LANE_WIDTH * 4, 5);
    ctx.fillRect(LANE_START_X, JUDGMENT_LINE_Y - LINE_GAP, LANE_WIDTH * 4, 5);

    // Draw good threshold
    ctx.fillStyle = 'green';
    ctx.globalAlpha = 0.5;
    ctx.fillRect(LANE_START_X, CANVAS_HEIGHT - GOOD_THRESHOLD, LANE_WIDTH * 4, GOOD_THRESHOLD);
    ctx.globalAlpha = 1;
    // Draw arrow markers
    const arrowDirections = ['left', 'down', 'up', 'right'];
    for (let i = 0; i < 4; i++) {
        drawArrow(LANE_START_X + i * LANE_WIDTH + LANE_WIDTH / 2 - 10, CANVAS_HEIGHT - 80, arrowDirections[i], power[i]);
    }
    if (!(isPlayback || isRecording)) {
        audioSource.stop();
        keys = [];
        return;
    } 
    requestAnimationFrame(gameLoop);
}

function recordLoop() {
    // Clear the canvas
    ctx.clearRect(LANE_START_X, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (!isRecording && recordedKeys.length > 0 && currentTime >= recordedKeys[0].time) {
        // Generate new notes
        generateNotes(recordedKeys[0].key);
        recordedKeys.shift();
    }

    // Update and draw notes
    notes.forEach((note, index) => {
        note.y += NOTE_SPEED;
        if (note.y < 0 - NOTE_WIDTH) {
            notes.splice(index, 1);
        } else {
            ctx.fillStyle = ['red', 'blue', 'green', 'yellow'][note.lane];
            ctx.fillRect(note.x, CANVAS_HEIGHT - note.y-NOTE_WIDTH/2, LANE_WIDTH, 100);
        }
    });

    // Draw lane separators
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(LANE_START_X + i * LANE_WIDTH, 0);
        ctx.lineTo(LANE_START_X + i * LANE_WIDTH, JUDGMENT_LINE_Y + LINE_GAP + 3);
        ctx.stroke();
    }
    
    // Draw judgment line
    ctx.fillStyle = 'white';
    ctx.fillRect(LANE_START_X, JUDGMENT_LINE_Y + LINE_GAP, LANE_WIDTH * 4, 5);
    ctx.fillRect(LANE_START_X, JUDGMENT_LINE_Y - LINE_GAP, LANE_WIDTH * 4, 5);

    // Draw arrow markers
    const arrowDirections = ['left', 'down', 'up', 'right'];
    for (let i = 0; i < 4; i++) {
        drawArrow(LANE_START_X + i * LANE_WIDTH + LANE_WIDTH / 2 - 10, CANVAS_HEIGHT - 80, arrowDirections[i], power[i]);
    }
    if (!(isPlayback || isRecording)) {
        audioSource.stop();
        keys = [];
        return;
    } 
    requestAnimationFrame(recordLoop);
}

// Load and play a song
function loadSong(url) {
    fetch(url)
        .then(response => response.arrayBuffer())
        .then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
        .then(buffer => {
            audioBuffer = buffer;
            playSong();
        })
        .catch(e => console.error('Error loading song:', e));
}

function playSong() {
    audioSource = audioContext.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.connect(audioContext.destination);
    audioSource.start(0);
}

function generateNotes(lane) {
    const map = {'a': 0, 's': 1, 'k': 2, 'l': 3}
    console.log('Generating note in lane:', lane);
    notes.push({ x: LANE_START_X + map[lane] * LANE_WIDTH, y: 0, lane: map[lane] });
}

function handleKeyPressPlaying(event) {
    const keyIndex = key_map.indexOf(event.code);
    if (keyIndex !== -1) {
        const lane = keyIndex;
        power[lane] = true;
        const nearestNote = notes.find(note => note.lane === lane && note.y > CANVAS_HEIGHT - GOOD_THRESHOLD);
        if (nearestNote) {
            const distance = Math.abs(nearestNote.y - JUDGMENT_LINE_Y);
            if (distance < PERFECT_THRESHOLD) {
                score += 100;
                combo++;
                scores[0]++;
                updateScoreboard('Perfect!');
            } else {
                score += 50;
                combo++;
                scores[1]++;
                updateScoreboard('Good!');
            }
            notes = notes.filter(note => note !== nearestNote);
        } else {
            combo = 0;
            
            updateScoreboard('Miss!');
        }
    }
    if (recordedKeys.length == 0 && notes.length == 0) {
        stopPlayback();
    }
}
function handleKeyRelease(event) {
    const keyIndex = key_map.indexOf(event.code);
    if (keyIndex !== -1) {
        const lane = keyIndex;
        power[lane] = false;
    }
}

function drawArrow(x, y, direction, bold = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    switch(direction) {
        case 'left':
            ctx.moveTo(20, 0);
            ctx.lineTo(0, 10);
            ctx.lineTo(20, 20);
            break;
        case 'down':
            ctx.moveTo(0, 0);
            ctx.lineTo(10, 20);
            ctx.lineTo(20, 0);
            break;
        case 'up':
            ctx.moveTo(0, 20);
            ctx.lineTo(10, 0);
            ctx.lineTo(20, 20);
            break;
        case 'right':
            ctx.moveTo(0, 0);
            ctx.lineTo(20, 10);
            ctx.lineTo(0, 20);
            break;
    }
    if(bold){
        ctx.lineWidth = 21;
    }
    else {
        ctx.lineWidth = 4;
    }
    ctx.fillStyle = 'white';
    ctx.stroke();
    ctx.restore();
}

function drawFunkyText(word) {
    ctx.font = 'bold 48px Comic Sans MS, cursive, sans-serif';
    ctx.fillStyle = 'orange';
    ctx.strokeStyle = 'blue';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowOffsetX = 5;
    ctx.shadowOffsetY = 5;
    ctx.shadowBlur = 5;
    ctx.save();
    ctx.translate(20 + Math.random() * 5, CANVAS_HEIGHT - 200 + Math.random() * 20) ;
    ctx.rotate(Math.random() * 0.3- .15);
    // ctx.rotate(-0.1); // Slight rotation for funkiness
    ctx.fillText(word, 0, 0);
    ctx.restore();
}

function updateScoreboard(text = "") {
    ctx.clearRect(0, 0, LANE_START_X, CANVAS_HEIGHT);
    drawFunkyText(text);
    ctx.fillStyle = 'white';
    ctx.font = '24px Arial';
    ctx.fillText(`Perfect: ${scores[0]}`, 10, 30);
    ctx.fillText(`Good: ${scores[1]}`, 10, 60);
    ctx.fillText(`Miss: ${scores[2]}`, 10, 90);
    ctx.fillText(`Score: ${score}`, 10, CANVAS_HEIGHT - 60);
    ctx.fillText(`Combo: ${combo}`, 10, CANVAS_HEIGHT - 30);
}
function startPlayback(songNum) {
    if (isPlayback) return;
    console.log('Starting playback');
    document.addEventListener('keydown', handleKeyPressPlaying);
    PLAYBACKBUTTON.textContent = 'Stop Playback';
    isPlayback = true;
    score = 0;
    combo = 0;
    // Set up audio context
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    map = ['night.mp3', 'night.mp3', 'night.mp3', 'night.mp3', 'night.mp3']
    loadSong(map[songNum]);
    scores = [0,0,0]
    console.log("Starting complete");
    init();
}

function stopPlayback() {
    if (!isPlayback) return;
    console.log('Stopping playback');
    document.removeEventListener('keydown', handleKeyPressPlaying);
    isPlayback = false;
    PLAYBACKBUTTON.textContent = 'Import Beatmap';
    
    // document.removeEventListener('keydown', handleKeyPressPlaying);
    console.log("stopping complete");
}


function loadMapping(file, songNum = 0) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const contents = e.target.result;
        const lines = contents.split('\n');
        recordedKeys = lines.slice(1).map(line => {
            const [key, time] = line.split(',');
            return { key, time: parseInt(time) };
        });
        console.log(recordedKeys);
        console.log("Map loaded");
        startPlayback(songNum);
    };
    reader.readAsText(file);
}

function loadLocalMapping(filePath, songNum = 0) {
    fetch(filePath)
    .then(response => {
        if (!response.ok) {
            throw new Error(`Network response was not ok: ${response.statusText}`);
        }
        return response.text();
    })
    .then(contents => {
        const lines = contents.split('\n');
        recordedKeys = lines.slice(1).map(line => {
            const [key, time] = line.split(',');
            return { key, time: parseInt(time, 10) };
        });
        console.log(recordedKeys);
        console.log("Map loaded");
        startPlayback(songNum);
    })
    .catch(e => console.error('Error loading mapping file:', e));
}

PLAYBACKBUTTON.addEventListener('click', () => {
    console.log(isPlayback);
    if (isPlayback) {
        stopPlayback();
    } else {
        LOADINPUT.click();
    }
});

LOADINPUT.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        console.log(isPlayback);
        loadMapping(file);
    }
});

RECORD.addEventListener('click', () => {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
});


function toggleDropdown() {
    if (isPlayback) return;
    document.getElementById("myDropdown").classList.toggle("show");
}

// Close the dropdown if the user clicks outside of it
window.onclick = function(event) {
    if (!event.target.matches('button')) {
        var dropdowns = document.getElementsByClassName("dropdown-content");
        for (var i = 0; i < dropdowns.length; i++) {
            var openDropdown = dropdowns[i];
            if (openDropdown.classList.contains('show')) {
                openDropdown.classList.remove('show');
            }
        }
    }
}

function runSong(songNum) {
    if (isPlayback) return;
    console.log('Starting playback');
    var dropdowns = document.getElementsByClassName("dropdown-content");
    for (var i = 0; i < dropdowns.length; i++) {
        var openDropdown = dropdowns[i];
        if (openDropdown.classList.contains('show')) {
            openDropdown.classList.remove('show');
        }
    }
    console.log("Starting complete");
    beatMap = ['yeee.csv', 'super1.csv', 'super2.csv', 'super.csv', 'hard.csv', 'night.csv']
    loadLocalMapping('assets/' + beatMap[songNum]);
}

// recording logic
function startRecording() {
    if (isRecording) return;
    updateScoreboard("Recording");
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    isRecording = true;
    recordedKeys = [];
    score = 0;
    RECORD.textContent = 'Stop Recording';
    loadSong('night.mp3');
    document.addEventListener('keydown', handleKeyPressRecord);
    init();
}

function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    RECORD.textContent = 'Record Beatmap';
    document.removeEventListener('keydown', handleKeyPressRecord);
    saveRecordingToCSV();
}

function saveRecordingToCSV() {
    console.log("Recorded keys: ", recordedKeys);
    const csvContent = "data:text/csv;charset=utf-8," 
        + "key,time\n"
        + recordedKeys.map(keypress => `${keypress.key},${keypress.time}`).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "keypress_mapping.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    recordedKeys = [];
    notes = [];
}

function setTargetButton(button) {
    targetButton = button;
    button.textContent = "Press a key...";
    // Add keydown event listener to the document
    document.addEventListener('keydown', handleKeyPress);
}


function handleKeyPressRecord(event) {
    const keyIndex = key_map.indexOf(event.code);
    if (keyIndex !== -1) {
        const lane = keyIndex;
        power[lane] = true;
        const map = ['a', 's', 'k', 'l'];
        console.log("Lane pressed: ", map[lane]);
        const key = map[lane];
        generateNotes(key);
        recordedKeys.push({
            key: key,
            time: Date.now() - gameStartTime
        });
    }
}

function handleKeyPress(event) {
    if (targetButton) {
        let keyPressed = event.key;

        // Map arrow keys to arrow symbols
        const arrowKeys = {
            ArrowUp: "↑",
            ArrowDown: "↓",
            ArrowLeft: "←",
            ArrowRight: "→"
        };

        if (arrowKeys[keyPressed]) {
            keyPressed = arrowKeys[keyPressed];
        }

        targetButton.textContent = keyPressed;
        key_map[targetButton.id] = event.code;
        targetButton = null; 

        document.removeEventListener('keydown', handleKeyPress);
    }
}

document.getElementById('0').addEventListener('click', function() {
    setTargetButton(this);
});
document.getElementById('1').addEventListener('click', function() {
    setTargetButton(this);
});
document.getElementById('2').addEventListener('click', function() {
    setTargetButton(this);
});
document.getElementById('3').addEventListener('click', function() {
    setTargetButton(this);
});

init();