// =====================================================================
// PracticeChords.io — 메인 앱 스크립트
// 코드 생성 엔진, 메트로놈 스케줄러, UI 이벤트 처리
// =====================================================================

const themeBtn = document.getElementById('theme-btn');
themeBtn.addEventListener('click', () => {
    document.body.classList.toggle('light-mode');
    themeBtn.innerText = document.body.classList.contains('light-mode') ? 'DARK MODE' : 'LIGHT MODE';
});

document.getElementById('top-logo').addEventListener('click', () => {
    stop();
    document.getElementById('practice-screen').classList.add('hidden');
    document.getElementById('voicing-screen').classList.add('hidden');
    document.getElementById('home-screen').classList.remove('hidden');
});

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// 🎵 정확한 타이밍으로 클릭음을 "예약" (오디오 시계 기준)
// 지금 당장 재생하는 게 아니라, 지정된 audioCtx 시각에 재생되도록 예약합니다.
// UI(라이트, 코드 전환)도 그 시각에 맞춰 setTimeout으로 동기화합니다.
function scheduleClick(beatNumber, time) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const isFirst = beatNumber === 0;

    // 1) 소리 예약
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isFirst ? 1200 : 800, time);
    g.gain.setValueAtTime(0.4, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(g); g.connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + 0.05);

    // 2) 화면 업데이트를 같은 시각에 예약 (오디오-비주얼 동기화)
    const delayMs = Math.max(0, (time - audioCtx.currentTime) * 1000);
    setTimeout(() => {
        document.querySelectorAll('.light').forEach((l, i) => l.classList.toggle('active', i === beatNumber));
        if (isFirst) updateChordSequence();
    }, delayMs);
}

let activeRoots = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
let activeTypes = ['maj7', '7', 'm7'];

let currentChord = "", nextChord = "", prevChord = "";

const filterPanel = document.getElementById('filter-panel');
const chordPills = document.querySelectorAll('.chord-pill');

chordPills.forEach(pill => {
    pill.addEventListener('click', () => { pill.classList.toggle('active'); updateFilters(); });
});

function updateFilters() {
    activeRoots = [];
    document.querySelectorAll('#root-pills .chord-pill.active').forEach(p => activeRoots.push(...p.getAttribute('data-root').split(',')));
    activeTypes = [];
    document.querySelectorAll('.chord-pill.active[data-val]').forEach(p => activeTypes.push(p.getAttribute('data-val')));

    // 패널이 열려있다면 슬라이더도 실시간 새로고침
    if (weightConfigPanel && weightConfigPanel.style.display === 'block') {
        renderWeightSliders();
    }

    // 🚀 선택이 바뀔 때마다 Firestore에 저장 예약 (로그인 안 돼 있으면 auth.js 쪽에서 무시)
    scheduleSave();
}

// =====================================================================
// 💾 사용자 설정 저장/복원 (Firebase Firestore 연동)
// =====================================================================
// - getCurrentSettings(): 현재 UI 상태를 JSON으로 수집
// - scheduleSave(): 1초 디바운스로 window.saveChordSettings() 호출
// - 'user-settings-loaded' 이벤트: auth.js가 로그인 직후 보내는 저장 데이터 수신 → UI 복원
let suppressSave = false; // 복원 중 역저장 방지
let saveTimer = null;     // 디바운스 타이머

function getCurrentSettings() {
    const selectedRoots = [];
    document.querySelectorAll('#root-pills .chord-pill.active').forEach(p => {
        selectedRoots.push(p.getAttribute('data-root'));
    });
    const selectedTypes = [];
    document.querySelectorAll('.chord-pill.active[data-val]').forEach(p => {
        selectedTypes.push(p.getAttribute('data-val'));
    });
    // 🚀 Firestore는 빈 문자열 키 및 '__ 로 시작/끝나는' 키를 거부하므로
    //    '' → 'M' 으로 인코딩해서 저장 (메이저 트라이어드는 내부적으로 '' 로 표현됨)
    const weightsForSave = {};
    Object.keys(chordWeights).forEach(key => {
        const safeKey = key === '' ? 'M' : key;
        weightsForSave[safeKey] = chordWeights[key];
    });
    return {
        selectedRoots,
        selectedTypes,
        chordWeights: weightsForSave
    };
}

function scheduleSave() {
    if (suppressSave) return;
    if (typeof window.saveChordSettings !== 'function') return; // auth.js 아직 준비 안 됨
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        window.saveChordSettings(getCurrentSettings());
    }, 1000); // 1초 디바운스
}

window.addEventListener('user-settings-loaded', (e) => {
    const settings = e.detail || {};
    suppressSave = true;
    try {
        // 1) 가중치 복원 (기본값 구조를 유지한 채 값만 덮어씀)
        //    저장 시 '' → 'M' 으로 인코딩됐으므로 복원 시 역변환
        if (settings.chordWeights && typeof settings.chordWeights === 'object') {
            Object.keys(settings.chordWeights).forEach(key => {
                const realKey = key === 'M' ? '' : key;
                if (realKey in chordWeights) {
                    chordWeights[realKey] = settings.chordWeights[key];
                }
            });
        }
        // 2) Base pill 복원
        if (Array.isArray(settings.selectedRoots)) {
            document.querySelectorAll('#root-pills .chord-pill').forEach(p => p.classList.remove('active'));
            settings.selectedRoots.forEach(val => {
                const p = document.querySelector(`#root-pills .chord-pill[data-root="${val}"]`);
                if (p) p.classList.add('active');
            });
        }
        // 3) Chord type pill 복원 (Triads / 7ths / Extensions 전체)
        if (Array.isArray(settings.selectedTypes)) {
            document.querySelectorAll('.chord-pill[data-val]').forEach(p => p.classList.remove('active'));
            settings.selectedTypes.forEach(val => {
                const p = document.querySelector(`.chord-pill[data-val="${val}"]`);
                if (p) p.classList.add('active');
            });
        }
        // 4) 내부 상태 동기화 (슬라이더 패널 열려있으면 값도 즉시 새로고침)
        updateFilters();
    } finally {
        suppressSave = false;
    }
});
// =====================================================================

document.getElementById('base-all-btn').addEventListener('click', () => { document.querySelectorAll('#root-pills .chord-pill').forEach(p => p.classList.add('active')); updateFilters(); });
document.getElementById('base-clr-btn').addEventListener('click', () => { document.querySelectorAll('#root-pills .chord-pill').forEach(p => p.classList.remove('active')); updateFilters(); });
document.getElementById('triad-all-btn').addEventListener('click', () => { document.querySelectorAll('#triad-pills .chord-pill').forEach(p => p.classList.add('active')); updateFilters(); });
document.getElementById('triad-clr-btn').addEventListener('click', () => { document.querySelectorAll('#triad-pills .chord-pill').forEach(p => p.classList.remove('active')); updateFilters(); });
document.getElementById('seventh-all-btn').addEventListener('click', () => { document.querySelectorAll('#seventh-pills .chord-pill').forEach(p => p.classList.add('active')); updateFilters(); });
document.getElementById('seventh-clr-btn').addEventListener('click', () => { document.querySelectorAll('#seventh-pills .chord-pill').forEach(p => p.classList.remove('active')); updateFilters(); });
document.getElementById('ext-all-btn').addEventListener('click', () => { document.querySelectorAll('#ext-pills .chord-pill').forEach(p => p.classList.add('active')); updateFilters(); });
document.getElementById('ext-clr-btn').addEventListener('click', () => { document.querySelectorAll('#ext-pills .chord-pill').forEach(p => p.classList.remove('active')); updateFilters(); });
document.getElementById('filter-toggle-btn').addEventListener('click', () => filterPanel.classList.toggle('hidden'));

function checkSelection() {
    if (activeRoots.length === 0 || activeTypes.length === 0) {
        alert("Please select at least one Base and one Chord Type to start practicing!");
        return false;
    }
    return true;
}

function formatChordHTML(chordStr) {
    if (!chordStr) return "";
    if (chordStr === "---") return `<span class="chord-root">---</span>`;

    const root = chordStr.charAt(0);
    let acc = ""; let quality = ""; let rest = chordStr.slice(1);

    if (rest.startsWith('#') || rest.startsWith('b')) {
        acc = rest.charAt(0) === 'b' ? '♭' : '♯'; quality = rest.slice(1);
    } else { quality = rest; }

    if (quality === "M") quality = "";

    let accTag = acc ? `<span class="chord-acc">${acc}</span>` : '';
    let qMargin = acc ? '-0.05em' : '0.05em';
    let qStyle = quality ? ` style="margin-left: ${qMargin};"` : '';
    let qTag = quality ? `<span class="chord-quality"${qStyle}>${quality}</span>` : '';

    return `<span class="chord-root">${root}</span>${accTag}${qTag}`;
}

// --- 🎛️ 가중치 데이터 초기 설정 ---
let chordWeights = {
    '': 100, 'm': 100, 'dim': 10, 'aug': 10, 'sus4': 30,
    'maj7': 100, '7': 100, 'm7': 100, 'm7b5': 40, 'dim7': 20, '7sus4': 30, 'mM7': 10,
    // 🚀 새로운 텐션들 추가 (초기 점수는 10점 셋팅)
    'maj9': 10, 'm9': 10, 'm11': 10, '9': 10, '13': 10,
    '7(b9)': 10, '7(#9)': 10, '7alt': 10
};

const chordDisplayNames = {'': 'M', 'm': 'm', 'dim': 'dim', 'aug': 'aug', 'sus4': 'sus4', 'maj7': 'maj7', '7': '7', 'm7': 'm7', 'm7b5': 'm7(b5)', 'dim7': 'dim7', '7sus4': '7sus4', 'mM7': 'mM7', 'maj9': 'maj9', 'm9': 'm9', 'm11': 'm11', '9': '9', '13': '13',
    '7(b9)': '7(b9)', '7(#9)': '7(#9)', '7alt': '7alt'};

// 🚀 내부값 → 화면에 표시될 코드 접미사 변환 (한 곳에서 관리)
// chordDisplayNames는 슬라이더 라벨용(메이저='M')이라 별도로 둡니다.
const chordSuffixDisplay = {
    'm7b5': 'm7(b5)'
    // 나중에 다른 변환 규칙 생기면 여기에 한 줄 추가
};
function toDisplayType(type) {
    return chordSuffixDisplay[type] || type;
}

// --- 기존 무작위 함수를 가중치 함수로 교체 ---
function generateOneChord() {
    if (activeRoots.length === 0 || activeTypes.length === 0) return "---";
    const r = activeRoots[Math.floor(Math.random() * activeRoots.length)];

    // 1. 활성화된 코드들의 가중치 총합 계산
    let totalWeight = 0;
    activeTypes.forEach(type => { totalWeight += chordWeights[type]; });

    // (예외 처리) 모든 가중치가 0이면 1/n 무작위 처리
    if (totalWeight === 0) {
        const t = activeTypes[Math.floor(Math.random() * activeTypes.length)];
        return r + toDisplayType(t);
    }

    // 2. 가중치 기반 랜덤 뽑기
    let randomNum = Math.random() * totalWeight;
    let selectedType = activeTypes[0];

    for (let type of activeTypes) {
        const weight = chordWeights[type];
        if (randomNum < weight) {
            selectedType = type;
            break;
        }
        randomNum -= weight;
    }

    return r + toDisplayType(selectedType);
}

// --- ⚙️ 아코디언 열기/닫기 및 슬라이더 생성 로직 ---
const weightToggleBtn = document.getElementById('weight-toggle-btn');
const weightConfigPanel = document.getElementById('weight-config-panel');
const weightSlidersContainer = document.getElementById('weight-sliders-container');

weightToggleBtn.addEventListener('click', () => {
    if (weightConfigPanel.style.display === 'block') {
        weightConfigPanel.style.display = 'none';
        weightToggleBtn.innerText = ' ADVANCED WEIGHTS ▾';
    } else {
        weightConfigPanel.style.display = 'block';
        weightToggleBtn.innerText = ' CLOSE SETTINGS ▴';
        renderWeightSliders();
    }
});

function renderWeightSliders() {
    weightSlidersContainer.innerHTML = ''; // 초기화

    if (activeTypes.length === 0) return; // 켜진 코드가 없으면 중지

    activeTypes.forEach(type => {
        const div = document.createElement('div');
        div.className = 'weight-row';
        // 🚀 span 태그를 input 태그로 변경
        div.innerHTML = `
            <span class="weight-label">${chordDisplayNames[type]}</span>
            <div class="weight-slider-wrapper">
                <input type="range" class="weight-slider" min="0" max="100" value="${chordWeights[type]}" data-type="${type}">
                <input type="number" class="weight-value-input" min="0" max="100" value="${chordWeights[type]}" data-type="${type}">
            </div>
        `;
        weightSlidersContainer.appendChild(div);
    });

    // 🚀 슬라이더와 입력창 서로 동기화시키기
    const rows = weightSlidersContainer.querySelectorAll('.weight-slider-wrapper');

    rows.forEach(wrapper => {
        const slider = wrapper.querySelector('.weight-slider');
        const numInput = wrapper.querySelector('.weight-value-input');
        const type = slider.getAttribute('data-type');

        // 1) 슬라이더를 움직일 때 -> 입력창 숫자 변경
        slider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            numInput.value = val;
            chordWeights[type] = val;
            scheduleSave(); // 🚀 가중치 변경도 Firestore에 저장 예약 (디바운스)
        });

        // 2) 숫자를 직접 입력할 때 -> 슬라이더 위치 변경
        numInput.addEventListener('change', (e) => {
            let val = parseInt(e.target.value);

            // 이상한 문자나 범위를 벗어난 숫자 방어 로직
            if (isNaN(val)) val = 50;
            if (val < 0) val = 0;
            if (val > 100) val = 100;

            e.target.value = val; // 교정된 숫자를 창에 다시 띄움
            slider.value = val;   // 슬라이더 바도 이동시킴
            chordWeights[type] = val;
            scheduleSave(); // 🚀 숫자 직접 입력도 저장
        });
    });
}

function updateChordSequence() {
    prevChord = currentChord; currentChord = nextChord; nextChord = generateOneChord();
    document.getElementById('chord-prev').innerHTML = formatChordHTML(prevChord);
    document.getElementById('chord-current').innerHTML = formatChordHTML(currentChord);
    document.getElementById('chord-next').innerHTML = formatChordHTML(nextChord);
}

function initChords() {
    prevChord = ""; currentChord = generateOneChord(); nextChord = generateOneChord();
    document.getElementById('chord-prev').innerHTML = "";
    document.getElementById('chord-current').innerHTML = formatChordHTML(currentChord);
    document.getElementById('chord-next').innerHTML = formatChordHTML(nextChord);
}

let isPlaying = false, currentBeat = 0, currentMode = 'TAP';
const bpmInput = document.getElementById('bpm-input'), bpmSlider = document.getElementById('bpm-slider'), beatsInput = document.getElementById('beats-input'), playBtn = document.getElementById('play-pause-btn');

let lastValidBPM = 80;
function getSafeBPM() {
    let bpm = parseInt(bpmInput.value);
    if (isNaN(bpm)) bpm = lastValidBPM;
    if (bpm < 40) bpm = 40; if (bpm > 240) bpm = 240;
    bpmInput.value = bpm; bpmSlider.value = bpm; lastValidBPM = bpm; return bpm;
}

let lastValidBeats = 4;
function getSafeBeats() {
    let b = parseInt(beatsInput.value);
    if (isNaN(b)) b = lastValidBeats;
    if (b < 1) b = 1; if (b > 4) b = 4;
    beatsInput.value = b; lastValidBeats = b; return b;
}

// --- 🎵 Web Audio API 기반 정밀 스케줄러 (setInterval 드리프트 문제 해결) ---
// 핵심 아이디어: 다음 박자를 "지금 재생"하지 않고, 오디오 시계에 미리 "예약"합니다.
// 자바스크립트가 잠시 버벅여도 오디오 하드웨어는 예약된 시각에 정확히 재생합니다.
const LOOKAHEAD_MS = 25;         // 스케줄러가 25ms마다 깨어나서 체크
const SCHEDULE_AHEAD_SEC = 0.1;  // 지금 + 100ms 안에 울릴 박자를 미리 예약
let nextNoteTime = 0.0;           // 다음 박자가 울릴 audioCtx 시각 (초)
let schedulerTimerId = null;      // 스케줄러 반복 타이머 id

function advanceNote() {
    // 다음 박자 시각 = 현재 박자 시각 + (60초 / BPM)
    // getSafeBPM/getSafeBeats를 매번 호출 → BPM/Beats 변경 시 다음 박자부터 자동 반영
    nextNoteTime += 60.0 / getSafeBPM();
    currentBeat = (currentBeat + 1) % getSafeBeats();
}

function scheduler() {
    // 아직 예약 안 된 박자들 중 100ms 내에 울려야 할 것들을 모두 예약
    while (nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD_SEC) {
        scheduleClick(currentBeat, nextNoteTime);
        advanceNote();
    }
}

function startMetronome() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    currentBeat = 0;
    // 첫 박은 50ms 뒤에 — 브라우저가 준비할 시간 확보
    nextNoteTime = audioCtx.currentTime + 0.05;
    schedulerTimerId = setInterval(scheduler, LOOKAHEAD_MS);
}

function stopMetronome() {
    if (schedulerTimerId !== null) {
        clearInterval(schedulerTimerId);
        schedulerTimerId = null;
    }
}

// BPM/Beats 변경은 재시작 불필요 — 스케줄러가 다음 박자부터 자동 반영
bpmSlider.addEventListener('input', () => {
    bpmInput.value = bpmSlider.value;
    lastValidBPM = parseInt(bpmSlider.value);
});

bpmInput.addEventListener('change', () => {
    getSafeBPM();
});

beatsInput.addEventListener('change', () => {
    getSafeBeats();
    currentBeat = 0;
    createLights();
});

function createLights() {
    const lightsContainer = document.getElementById('beat-lights'); lightsContainer.innerHTML = '';
    let count = currentMode === 'TAP' ? 4 : getSafeBeats();
    for (let i = 0; i < count; i++) {
        const div = document.createElement('div'); div.className = 'light';
        if (currentMode === 'TAP') div.style.opacity = "0";
        lightsContainer.appendChild(div);
    }
}

document.getElementById('tap-mode-btn').addEventListener('click', (e) => { currentMode = 'TAP'; stop(); e.target.classList.add('active'); document.getElementById('tempo-mode-btn').classList.remove('active'); document.getElementById('tempo-controls').classList.add('hidden'); document.getElementById('tap-controls').classList.remove('hidden'); createLights(); });
document.getElementById('tempo-mode-btn').addEventListener('click', (e) => { currentMode = 'TEMPO'; e.target.classList.add('active'); document.getElementById('tap-mode-btn').classList.remove('active'); document.getElementById('tempo-controls').classList.remove('hidden'); document.getElementById('tap-controls').classList.add('hidden'); createLights(); });

document.getElementById('start-btn-home').addEventListener('click', () => {
    if (!checkSelection()) return;
    document.getElementById('home-screen').classList.add('hidden'); document.getElementById('practice-screen').classList.remove('hidden');
    initChords(); createLights();
});

function stop() {
    stopMetronome();
    isPlaying = false;
    currentBeat = 0;
    playBtn.innerText = 'Play';
    document.querySelectorAll('.light').forEach(l => l.classList.remove('active'));
}

playBtn.addEventListener('click', () => {
    if (isPlaying) { stop(); return; }
    if (!checkSelection()) return;
    getSafeBPM(); // BPM 값 검증
    isPlaying = true;
    playBtn.innerText = 'Stop';
    startMetronome();
});

document.getElementById('next-btn').addEventListener('click', () => { if (!checkSelection()) return; updateChordSequence(); });

// 🚀 공통 트리거: TAP이면 다음 코드, TEMPO면 재생/정지 토글
// 스페이스바와 빈 공간 클릭이 둘 다 이 함수를 부릅니다.
function triggerPractice() {
    if (document.getElementById('practice-screen').classList.contains('hidden')) return;
    if (currentMode === 'TAP') {
        if (checkSelection()) document.getElementById('next-btn').click();
    } else if (currentMode === 'TEMPO') {
        document.getElementById('play-pause-btn').click();
    }
}

// 스페이스바 누르면 연습 트리거
window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    // 버튼에 포커스 남아있으면 풀어주기 (스페이스가 두 번 먹히는 것 방지)
    if (document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
    if (document.getElementById('practice-screen').classList.contains('hidden')) return;
    e.preventDefault();
    triggerPractice();
});

// 화면 빈 공간 클릭 시 연습 트리거 (버튼/입력/필터 등은 자기 이벤트가 따로 있음)
document.addEventListener('click', (e) => {
    if (document.getElementById('practice-screen').classList.contains('hidden')) return;
    if (e.target.closest('button, input, a, #filter-panel, .mode-selector, #top-logo, #top-bar-bg, .setting-group, #footer-area')) return;
    triggerPractice();
});

document.getElementById('back-btn').addEventListener('click', () => { stop(); document.getElementById('practice-screen').classList.add('hidden'); document.getElementById('home-screen').classList.remove('hidden'); });

// =====================================================================
// 🎹 보이싱 라이브러리 (Voicing Library)
// =====================================================================
// 핵심 아이디어: 보이싱을 "루트로부터의 반음 간격"으로 저장하면 어떤 키로든 이동 가능.
//   예) Cm7에서 C-Eb-G-Bb-D 친 보이싱 → intervals: [0, 3, 7, 10, 14]
//   Ab로 옮겨 치고 싶을 때: 루트만 Ab로 바꾸면 자동으로 음이 재배치됨.

// --- 상수 정의 ---
const KEYBOARD_START_MIDI = 48;  // C3
const KEYBOARD_END_MIDI = 84;    // C6 (3옥타브 + 1)
const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
// 루트별 선호 표기 (b 쓰는 키 / # 쓰는 키 구분 — 간단 버전)
const FLAT_ROOTS = [1, 3, 5, 6, 8, 10]; // Db, Eb, F, Gb, Ab, Bb 쪽은 b 표기

// 현재 편집 상태
let voicingSelectedQuality = '';     // 기본 M
let voicingRootSemitone = 0;         // 기본 C
let voicingActiveMidiNotes = new Set(); // 건반에서 눌린 MIDI 번호들
let cachedVoicings = [];             // 현재 퀄리티의 저장된 보이싱 목록

// --- 건반 생성 ---
function buildPianoKeyboard() {
    const kbEl = document.getElementById('piano-keyboard');
    if (!kbEl) return;
    kbEl.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'piano-keys';

    // 흰건반 먼저 깔고, 검은건반은 absolute로 위에 얹음
    const whiteKeyIndexesInOctave = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
    const blackKeyIndexesInOctave = [1, 3, 6, 8, 10];       // C# D# F# G# A#

    // 흰건반 카운터 (검은건반 위치 계산용)
    let whiteCount = 0;
    const whiteKeyWidth = window.innerWidth <= 850 ? 24 : 32;
    const blackKeyWidth = window.innerWidth <= 850 ? 15 : 20;

    // 흰건반 렌더
    for (let midi = KEYBOARD_START_MIDI; midi <= KEYBOARD_END_MIDI; midi++) {
        const noteIdx = midi % 12;
        if (!whiteKeyIndexesInOctave.includes(noteIdx)) continue;
        const key = document.createElement('div');
        key.className = 'piano-key white';
        key.dataset.midi = midi;
        wrapper.appendChild(key);
        whiteCount++;
    }

    // 검은건반 렌더 (흰건반 사이에 올림)
    // 각 흰건반의 left 위치를 기반으로 계산
    let whiteIdx = 0;
    for (let midi = KEYBOARD_START_MIDI; midi <= KEYBOARD_END_MIDI; midi++) {
        const noteIdx = midi % 12;
        if (whiteKeyIndexesInOctave.includes(noteIdx)) {
            whiteIdx++;
            continue;
        }
        // 검은건반 — 직전 흰건반 오른쪽 끝에서 살짝 왼쪽에 배치
        const key = document.createElement('div');
        key.className = 'piano-key black';
        key.dataset.midi = midi;
        // 직전 흰건반이 whiteIdx-1 번째. 그 오른쪽 경계는 whiteIdx * whiteKeyWidth
        const leftPos = whiteIdx * whiteKeyWidth - (blackKeyWidth / 2);
        key.style.left = leftPos + 'px';
        wrapper.appendChild(key);
    }

    kbEl.appendChild(wrapper);

    // 클릭 이벤트 (이벤트 위임)
    wrapper.addEventListener('click', (e) => {
        const key = e.target.closest('.piano-key');
        if (!key) return;
        const midi = parseInt(key.dataset.midi);
        if (voicingActiveMidiNotes.has(midi)) {
            voicingActiveMidiNotes.delete(midi);
        } else {
            voicingActiveMidiNotes.add(midi);
        }
        refreshKeyboardVisual();
    });
}

// 건반 하이라이트 갱신 (active 노트 + 루트 표시)
function refreshKeyboardVisual() {
    document.querySelectorAll('#piano-keyboard .piano-key').forEach(key => {
        const midi = parseInt(key.dataset.midi);
        key.classList.toggle('active', voicingActiveMidiNotes.has(midi));
        // 루트 표시: 해당 semitone이 voicingRootSemitone과 같으면 .root
        key.classList.toggle('root', (midi % 12) === voicingRootSemitone);
    });
}

// 루트 pill / 퀄리티 pill 선택 UI
function setupVoicingPills() {
    // 퀄리티 pill — 싱글 셀렉트
    document.querySelectorAll('#voicing-quality-pills .chord-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('#voicing-quality-pills .chord-pill').forEach(x => x.classList.remove('active'));
            p.classList.add('active');
            voicingSelectedQuality = p.getAttribute('data-val');
            updateVoicingLabel();
            loadVoicingsForCurrentQuality();
        });
    });
    // 루트 pill — 싱글 셀렉트
    document.querySelectorAll('#voicing-root-pills .chord-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('#voicing-root-pills .chord-pill').forEach(x => x.classList.remove('active'));
            p.classList.add('active');
            voicingRootSemitone = parseInt(p.getAttribute('data-semitone'));
            updateVoicingLabel();
            refreshKeyboardVisual();
            // 루트 바뀌면 현재 건반 선택을 비우고 재시작 (혼동 방지)
            voicingActiveMidiNotes.clear();
            refreshKeyboardVisual();
            // 선택된 보이싱이 있었다면 다시 하이라이트 (루트 기준으로 재계산)
            highlightSelectedVoicingIfAny();
        });
    });
}

function updateVoicingLabel() {
    const rootName = FLAT_ROOTS.includes(voicingRootSemitone)
        ? NOTE_NAMES_FLAT[voicingRootSemitone]
        : NOTE_NAMES_SHARP[voicingRootSemitone];
    const suffix = toDisplayType(voicingSelectedQuality);
    document.getElementById('voicing-current-label').innerHTML = formatChordHTML(rootName.replace('b', 'b').replace('#', '#') + suffix);
}

// MIDI → 노트 이름 ("C4", "Eb5" 등)
function midiToNoteName(midi) {
    const noteIdx = midi % 12;
    const octave = Math.floor(midi / 12) - 1;
    const useFlat = FLAT_ROOTS.includes(voicingRootSemitone);
    const name = useFlat ? NOTE_NAMES_FLAT[noteIdx] : NOTE_NAMES_SHARP[noteIdx];
    return name + octave;
}

// 현재 건반 active 노트들을 → 루트 기준 interval 배열로 변환
function currentVoicingToIntervals() {
    // 루트 MIDI: 건반 범위 내 가장 낮은 루트음 (예: 루트가 C면 C3=48)
    // 그냥 가장 낮은 active 노트 기준으로 % 12 돌려 루트 찾아도 되지만,
    // 저장 규칙: "루트 음(semitone 기준)에서 실제 눌린 각 음까지 반음 거리" 로 통일.
    // 즉 루트 semitone의 가장 낮은 옥타브(voicingRootSemitone + 48 if >= 48)를 기준점으로 삼음.
    if (voicingActiveMidiNotes.size === 0) return [];
    const sortedNotes = [...voicingActiveMidiNotes].sort((a, b) => a - b);
    // 루트 기준: 가장 낮은 노트의 옥타브에서 "루트 semitone"을 찾음
    const lowestMidi = sortedNotes[0];
    // 루트 기준점: lowestMidi 이하에서 가장 가까운 voicingRootSemitone 위치
    let rootMidi = Math.floor(lowestMidi / 12) * 12 + voicingRootSemitone;
    if (rootMidi > lowestMidi) rootMidi -= 12;
    return sortedNotes.map(m => m - rootMidi);
}

// interval 배열 + 현재 루트 → 건반에 표시할 MIDI 배열
function intervalsToMidiNotes(intervals) {
    if (!Array.isArray(intervals) || intervals.length === 0) return [];
    // 기본 루트 위치: C3~C4 사이. 루트 semitone을 C3(48) 위로 올림 — 단, 너무 낮으면 한 옥타브 올림
    let baseRootMidi = 48 + voicingRootSemitone; // C3 + semitone
    const maxInterval = Math.max(...intervals);
    const minInterval = Math.min(...intervals);
    // 건반 범위 벗어나면 옥타브 조정
    while (baseRootMidi + maxInterval > KEYBOARD_END_MIDI && baseRootMidi >= 36) {
        baseRootMidi -= 12;
    }
    while (baseRootMidi + minInterval < KEYBOARD_START_MIDI && baseRootMidi <= 72) {
        baseRootMidi += 12;
    }
    return intervals.map(iv => baseRootMidi + iv);
}

// interval 배열을 "C Eb G Bb D" 같은 노트 이름 문자열로
function intervalsToNoteNamesStr(intervals) {
    const midiNotes = intervalsToMidiNotes(intervals);
    return midiNotes.map(m => {
        const noteIdx = m % 12;
        const useFlat = FLAT_ROOTS.includes(voicingRootSemitone);
        return useFlat ? NOTE_NAMES_FLAT[noteIdx] : NOTE_NAMES_SHARP[noteIdx];
    }).join(' ');
}

// --- 저장/불러오기/삭제 (Firestore 호출 — auth.js가 함수 제공) ---
async function saveCurrentVoicing() {
    if (voicingActiveMidiNotes.size === 0) {
        alert('Click some notes on the keyboard first!');
        return;
    }
    if (typeof window.saveVoicing !== 'function') {
        alert('Please sign in to save voicings.');
        return;
    }
    const intervals = currentVoicingToIntervals();
    try {
        await window.saveVoicing({
            chordQuality: voicingSelectedQuality,
            intervals
        });
        await loadVoicingsForCurrentQuality();
    } catch (err) {
        console.error('Save voicing failed:', err);
        alert('Failed to save voicing. Check console.');
    }
}

async function loadVoicingsForCurrentQuality() {
    if (typeof window.loadVoicings !== 'function') {
        cachedVoicings = [];
        renderVoicingList();
        return;
    }
    try {
        cachedVoicings = await window.loadVoicings(voicingSelectedQuality);
        renderVoicingList();
    } catch (err) {
        console.error('Load voicings failed:', err);
        cachedVoicings = [];
        renderVoicingList();
    }
}

async function deleteVoicing(voicingId) {
    if (typeof window.deleteVoicing !== 'function') return;
    if (!confirm('Delete this voicing?')) return;
    try {
        await window.deleteVoicing(voicingId);
        await loadVoicingsForCurrentQuality();
    } catch (err) {
        console.error('Delete voicing failed:', err);
    }
}

// 리스트 렌더
let currentlyHighlightedVoicingId = null;
function renderVoicingList() {
    const listEl = document.getElementById('voicing-list');
    listEl.innerHTML = '';

    if (!cachedVoicings || cachedVoicings.length === 0) {
        const empty = document.createElement('div');
        empty.id = 'voicing-empty-msg';
        empty.innerText = typeof window.saveVoicing !== 'function'
            ? 'Sign in to save and view your voicings.'
            : 'No voicings saved for this quality yet. Click notes on the keyboard and hit Save.';
        listEl.appendChild(empty);
        return;
    }

    cachedVoicings.forEach(v => {
        const row = document.createElement('div');
        row.className = 'voicing-row';
        if (v.id === currentlyHighlightedVoicingId) row.classList.add('active');
        row.innerHTML = `
            <div>
                <div class="voicing-row-notes">${intervalsToNoteNamesStr(v.intervals)}</div>
                <div class="voicing-row-meta">${v.intervals.length} notes · intervals [${v.intervals.join(', ')}]</div>
            </div>
            <button class="voicing-delete-btn" data-id="${v.id}" title="Delete">🗑</button>
        `;
        row.addEventListener('click', (e) => {
            if (e.target.closest('.voicing-delete-btn')) return;
            currentlyHighlightedVoicingId = v.id;
            voicingActiveMidiNotes = new Set(intervalsToMidiNotes(v.intervals));
            refreshKeyboardVisual();
            renderVoicingList(); // active row 표시 갱신
        });
        const delBtn = row.querySelector('.voicing-delete-btn');
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteVoicing(v.id);
        });
        listEl.appendChild(row);
    });
}

function highlightSelectedVoicingIfAny() {
    if (!currentlyHighlightedVoicingId) return;
    const v = cachedVoicings.find(x => x.id === currentlyHighlightedVoicingId);
    if (!v) return;
    voicingActiveMidiNotes = new Set(intervalsToMidiNotes(v.intervals));
    refreshKeyboardVisual();
}

// --- 화면 전환 ---
document.getElementById('voicing-btn-home').addEventListener('click', () => {
    document.getElementById('home-screen').classList.add('hidden');
    document.getElementById('voicing-screen').classList.remove('hidden');
    buildPianoKeyboard();
    refreshKeyboardVisual();
    updateVoicingLabel();
    loadVoicingsForCurrentQuality();
});

document.getElementById('voicing-back-btn').addEventListener('click', () => {
    document.getElementById('voicing-screen').classList.add('hidden');
    document.getElementById('home-screen').classList.remove('hidden');
});

// --- 버튼 이벤트 ---
document.getElementById('voicing-save-btn').addEventListener('click', saveCurrentVoicing);
document.getElementById('voicing-clear-btn').addEventListener('click', () => {
    voicingActiveMidiNotes.clear();
    currentlyHighlightedVoicingId = null;
    refreshKeyboardVisual();
    renderVoicingList();
});

// --- 초기화 ---
setupVoicingPills();

// 로그인 상태 바뀌면 리스트 다시 로드
window.addEventListener('user-settings-loaded', () => {
    if (!document.getElementById('voicing-screen').classList.contains('hidden')) {
        loadVoicingsForCurrentQuality();
    }
});

// =====================================================================

// PWA 서비스 워커 등록
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
        .then(() => console.log('Service Worker Registered'));
}
