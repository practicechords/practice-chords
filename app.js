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
        //    ⚠️ 범위를 #filter-panel 안으로 제한 — voicing 화면의 M pill(data-val="M")은 건드리지 않음
        if (Array.isArray(settings.selectedTypes)) {
            document.querySelectorAll('#filter-panel .chord-pill[data-val]').forEach(p => p.classList.remove('active'));
            settings.selectedTypes.forEach(val => {
                const p = document.querySelector(`#filter-panel .chord-pill[data-val="${val}"]`);
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
const KEYBOARD_START_MIDI = 21;  // A0 (88건반 최저음)
const KEYBOARD_END_MIDI = 108;   // C8 (88건반 최고음)
const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
// 루트별 선호 표기 (b 쓰는 키 / # 쓰는 키 구분 — 간단 버전)
const FLAT_ROOTS = [1, 3, 5, 6, 8, 10]; // Db, Eb, F, Gb, Ab, Bb 쪽은 b 표기

// 현재 편집 상태
let voicingSelectedQuality = 'M';    // 기본 M (HTML pill도 data-val="M"에 active)
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
        // C 건반에는 옥타브 라벨 (C1, C2 … C8) 달아서 위치 파악 쉽게
        if (noteIdx === 0) {
            const octave = Math.floor(midi / 12) - 1;
            const label = document.createElement('span');
            label.className = 'piano-key-label';
            label.textContent = 'C' + octave;
            key.appendChild(label);
        }
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

    // 🚀 초기 스크롤: C4(중간도, MIDI 60) 근처를 센터에 두기
    //    전체는 A0~C8(88건반)이지만 기본적으로 C3~C5 영역이 먼저 보이게.
    //    (rAF로 감싸서 layout이 계산된 다음 측정/스크롤되도록)
    requestAnimationFrame(() => scrollKeyboardToMidi(60));

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

// 특정 MIDI 음이 컨테이너 가운데 오도록 스크롤
function scrollKeyboardToMidi(targetMidi) {
    const kbEl = document.getElementById('piano-keyboard');
    if (!kbEl) return;
    const whiteKeyIndexesInOctave = [0, 2, 4, 5, 7, 9, 11];
    const whiteKeyWidth = window.innerWidth <= 850 ? 24 : 32;

    // targetMidi 에 가장 가까운 "아래쪽" 흰건반을 찾고, 그것의 좌측 좌표를 계산
    let whiteIdx = 0;
    let targetWhiteIdx = -1;
    for (let midi = KEYBOARD_START_MIDI; midi <= KEYBOARD_END_MIDI; midi++) {
        const noteIdx = midi % 12;
        if (whiteKeyIndexesInOctave.includes(noteIdx)) {
            if (midi >= targetMidi && targetWhiteIdx === -1) {
                targetWhiteIdx = whiteIdx;
                break;
            }
            whiteIdx++;
        }
    }
    if (targetWhiteIdx < 0) targetWhiteIdx = whiteIdx; // 끝에 있으면 마지막

    const targetLeft = targetWhiteIdx * whiteKeyWidth;
    // 컨테이너 가운데로 오게
    const containerWidth = kbEl.clientWidth;
    kbEl.scrollLeft = Math.max(0, targetLeft - containerWidth / 2);
}

// 건반 하이라이트 갱신 (active 노트만)
function refreshKeyboardVisual() {
    document.querySelectorAll('#piano-keyboard .piano-key').forEach(key => {
        const midi = parseInt(key.dataset.midi);
        key.classList.toggle('active', voicingActiveMidiNotes.has(midi));
    });
}

// 루트 pill / 퀄리티 pill 선택 UI
function setupVoicingPills() {
    // 퀄리티 pill — 싱글 셀렉트
    document.querySelectorAll('.voicing-quality-group .chord-pill').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.voicing-quality-group .chord-pill').forEach(x => x.classList.remove('active'));
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

// interval을 코드 도수 라벨로 변환 (재즈 실용 기준) — 퀄리티별 컨텍스트 반영
// 같은 음이라도 맥락에 따라 다르게 표기:
//   maj7의 #11  vs  m7b5의 b5  (둘 다 6반음)
//   aug의 #5    vs  13 코드의 b13 (둘 다 8반음)
//   sus4의 4    vs  일반 코드의 11 (둘 다 5반음)
//   dim7의 bb7  vs  dom7(13)의 13 (둘 다 9반음)
//   minor의 b3  vs  dom7의 #9 (둘 다 3반음)
const DEGREE_MAPS = {
    // Major 계열 — 3 semitones는 #9 (블루노트 텐션)으로 해석, 6은 #11
    'M':      ['1', 'b9', '9', '#9', '3', '11', '#11', '5', 'b13', '13', 'b7', '7'],
    'maj7':   ['1', 'b9', '9', '#9', '3', '11', '#11', '5', 'b13', '13', 'b7', '7'],
    'maj9':   ['1', 'b9', '9', '#9', '3', '11', '#11', '5', 'b13', '13', 'b7', '7'],
    // Minor 계열 — 3 semitones는 b3 (코드톤)
    'm':      ['1', 'b9', '9', 'b3', '3', '11', '#11', '5', 'b13', '13', 'b7', '7'],
    'm7':     ['1', 'b9', '9', 'b3', '3', '11', '#11', '5', 'b13', '13', 'b7', '7'],
    'm9':     ['1', 'b9', '9', 'b3', '3', '11', '#11', '5', 'b13', '13', 'b7', '7'],
    'm11':    ['1', 'b9', '9', 'b3', '3', '11', '#11', '5', 'b13', '13', 'b7', '7'],
    'mM7':    ['1', 'b9', '9', 'b3', '3', '11', '#11', '5', 'b13', '13', 'b7', '7'],
    // Dominant 계열 — 3 semitones는 #9 (블루노트/alt)
    '7':      ['1', 'b9', '9', '#9', '3', '11', '#11', '5', 'b13', '13', 'b7', '7'],
    '9':      ['1', 'b9', '9', '#9', '3', '11', '#11', '5', 'b13', '13', 'b7', '7'],
    '13':     ['1', 'b9', '9', '#9', '3', '11', '#11', '5', 'b13', '13', 'b7', '7'],
    '7(b9)':  ['1', 'b9', '9', '#9', '3', '11', '#11', '5', 'b13', '13', 'b7', '7'],
    '7(#9)':  ['1', 'b9', '9', '#9', '3', '11', '#11', '5', 'b13', '13', 'b7', '7'],
    '7alt':   ['1', 'b9', '9', '#9', '3', '11', '#11', '5', 'b13', '13', 'b7', '7'],
    // Half-diminished — 6 semitones는 b5 (이 코드의 정체성)
    'm7b5':   ['1', 'b9', '9', 'b3', '3', '11', 'b5', '5', 'b13', '13', 'b7', '7'],
    // Diminished — 6은 b5, 9는 bb7 (dim7의 정체성)
    'dim':    ['1', 'b9', '9', 'b3', '3', '11', 'b5', '5', 'b13', 'bb7', 'b7', '7'],
    'dim7':   ['1', 'b9', '9', 'b3', '3', '11', 'b5', '5', 'b13', 'bb7', 'b7', '7'],
    // Augmented — 8 semitones는 #5 (이 코드의 정체성)
    'aug':    ['1', 'b9', '9', '#9', '3', '11', '#11', '5', '#5', '13', 'b7', '7'],
    // Suspended — 5 semitones는 4 (서스펜디드), 3 semitones는 #9
    'sus4':   ['1', 'b9', '9', '#9', '3', '4', '#11', '5', 'b13', '13', 'b7', '7'],
    '7sus4':  ['1', 'b9', '9', '#9', '3', '4', '#11', '5', 'b13', '13', 'b7', '7'],
};

// 기본 폴백 (맵에 없는 퀄리티가 들어오면)
const DEFAULT_DEGREES = ['1', 'b9', '9', '#9', '3', '11', '#11', '5', 'b13', '13', 'b7', '7'];

function intervalsToDegreesStr(intervals) {
    const map = DEGREE_MAPS[voicingSelectedQuality] || DEFAULT_DEGREES;
    return intervals.map(iv => map[iv % 12]).join(' ');
}

// 🕐 상대 시간 포맷 — "today" / "3 days ago" / "2 weeks ago" / "Mar 12" / "Mar 12, 2024"
// 1년 이상 지났으면 연도 포함해서 절대 날짜로, 그 이하는 맥락에 따라 상대/절대 혼용
function formatRelativeTime(firestoreTimestamp) {
    if (!firestoreTimestamp || typeof firestoreTimestamp.seconds !== 'number') return '';
    const date = new Date(firestoreTimestamp.seconds * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return 'just now'; // 서버/클라이언트 시계 오차
    if (diffDays < 1) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) {
        const w = Math.floor(diffDays / 7);
        return w === 1 ? '1 week ago' : `${w} weeks ago`;
    }
    // 한 달 이상: 절대 날짜. 같은 해면 연도 생략, 다른 해면 연도 포함
    const sameYear = date.getFullYear() === now.getFullYear();
    return date.toLocaleDateString('en-US', sameYear
        ? { month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric', year: 'numeric' }
    );
}

// HTML 이스케이프 (사용자 노트는 innerText로 써도 되지만 방어 차원)
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// --- 저장/불러오기/삭제 (Firestore 호출 — auth.js가 함수 제공) ---
async function saveCurrentVoicing() {
    if (voicingActiveMidiNotes.size === 0) {
        alert('Click some notes on the keyboard first!');
        return;
    }
    // 🔐 로그인 체크 — 안 돼 있으면 Google 로그인으로 바로 안내 (기술적 에러 대신 친절한 CTA)
    const signedIn = typeof window.isSignedIn === 'function' && window.isSignedIn();
    if (!signedIn) {
        const wantSignIn = confirm(
            'Sign in to save voicings to your library.\n\n' +
            'Your voicings sync across devices and stay available whenever you come back. ' +
            'Sign in with Google now?'
        );
        if (wantSignIn && typeof window.handleAuth === 'function') {
            window.handleAuth(); // Google 로그인 팝업 열림
        }
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
        // "Not signed in" 에러는 위에서 걸러지지만, 세션 만료 등 edge case 대응
        if (err && err.message === 'Not signed in') {
            alert('Your session has expired. Please sign in again.');
            return;
        }
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

// ⚠️ 이름 주의: window.deleteVoicing (auth.js, Firestore 직결)과 충돌 피하려고
//    app.js 쪽은 handleVoicingDelete로 명명
async function handleVoicingDelete(voicingId) {
    if (typeof window.deleteVoicing !== 'function') return;
    if (!confirm('Delete this voicing?')) return;
    try {
        await window.deleteVoicing(voicingId);
        // 🚀 Firestore 재조회 대신 로컬 배열에서 즉시 제거 (UI 바로 갱신)
        cachedVoicings = cachedVoicings.filter(v => v.id !== voicingId);
        if (currentlyHighlightedVoicingId === voicingId) {
            currentlyHighlightedVoicingId = null;
            voicingActiveMidiNotes.clear();
            refreshKeyboardVisual();
        }
        renderVoicingList();
    } catch (err) {
        console.error('Delete voicing failed:', err);
        alert('Failed to delete. Check console.');
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
        // 실제 로그인 상태로 메시지 분기 (saveVoicing 함수는 auth.js 로드되면 항상 존재해서 부정확했음)
        const signedInEmpty = typeof window.isSignedIn === 'function' && window.isSignedIn();
        empty.innerText = signedInEmpty
            ? 'No voicings saved for this quality yet. Click notes on the keyboard and hit Save.'
            : 'Sign in to save and view your voicings.';
        listEl.appendChild(empty);
        return;
    }

    cachedVoicings.forEach(v => {
        const row = document.createElement('div');
        row.className = 'voicing-row';
        if (v.id === currentlyHighlightedVoicingId) row.classList.add('active');

        const timeStr = formatRelativeTime(v.createdAt);
        const hasNote = v.note && v.note.trim().length > 0;
        const noteHtml = hasNote
            ? `<div class="voicing-row-note" data-id="${v.id}">${escapeHtml(v.note)}</div>`
            : `<div class="voicing-row-note voicing-row-note-empty" data-id="${v.id}">+ Add note</div>`;

        row.innerHTML = `
            <div class="voicing-row-body">
                <div class="voicing-row-header">
                    <div class="voicing-row-degrees">${intervalsToDegreesStr(v.intervals)}</div>
                    <div class="voicing-row-time">${timeStr}</div>
                </div>
                <div class="voicing-row-notes">${intervalsToNoteNamesStr(v.intervals)}</div>
                ${noteHtml}
            </div>
            <div class="voicing-row-actions">
                <button class="voicing-practice-btn" data-id="${v.id}" title="Practice this quality in all 12 keys">▶</button>
                <button class="voicing-delete-btn" data-id="${v.id}" title="Delete">🗑</button>
            </div>
        `;

        // 행 클릭: 보이싱을 건반에 로드 (단, 액션 버튼/노트 영역 클릭은 제외)
        row.addEventListener('click', (e) => {
            if (e.target.closest('.voicing-row-actions')) return;
            if (e.target.closest('.voicing-row-note')) return;
            if (e.target.closest('.voicing-row-note-editor')) return;
            currentlyHighlightedVoicingId = v.id;
            const notes = intervalsToMidiNotes(v.intervals);
            voicingActiveMidiNotes = new Set(notes);
            refreshKeyboardVisual();
            // 보이싱이 현재 스크롤 영역 밖이면, 보이싱 중앙음으로 스크롤 이동
            if (notes.length > 0) {
                const centerMidi = notes[Math.floor(notes.length / 2)];
                scrollKeyboardToMidi(centerMidi);
            }
            renderVoicingList();
        });

        const delBtn = row.querySelector('.voicing-delete-btn');
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            handleVoicingDelete(v.id);
        });

        const practiceBtn = row.querySelector('.voicing-practice-btn');
        practiceBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startPracticeFromVoicing(v);
        });

        // 노트 클릭 시 인라인 편집 모드로 전환
        const noteEl = row.querySelector('.voicing-row-note');
        noteEl.addEventListener('click', (e) => {
            e.stopPropagation();
            openNoteEditor(noteEl, v);
        });

        listEl.appendChild(row);
    });
}

// 📝 노트 인라인 편집: 표시 div를 textarea로 교체, blur/Enter에서 저장, Esc에서 취소
function openNoteEditor(noteEl, voicing) {
    if (typeof window.updateVoicingNote !== 'function') {
        alert('Please sign in to edit notes.');
        return;
    }
    const currentNote = voicing.note || '';
    const textarea = document.createElement('textarea');
    textarea.className = 'voicing-row-note-editor';
    textarea.value = currentNote;
    textarea.placeholder = 'Add a note…';
    // click이 부모 row로 버블링되어 보이싱이 로드되는 것을 방지
    textarea.addEventListener('click', (e) => e.stopPropagation());

    noteEl.replaceWith(textarea);
    textarea.focus();
    // 커서를 끝으로
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    let finalized = false;
    const commit = async (shouldSave) => {
        if (finalized) return;
        finalized = true;
        const newNote = textarea.value.trim();
        if (shouldSave && newNote !== currentNote.trim()) {
            try {
                await window.updateVoicingNote(voicing.id, newNote);
                // 로컬 캐시도 업데이트 (Firestore 재조회 생략)
                const idx = cachedVoicings.findIndex(x => x.id === voicing.id);
                if (idx >= 0) cachedVoicings[idx].note = newNote;
            } catch (err) {
                console.error('Failed to save note:', err);
                alert('Failed to save note. Check console.');
            }
        }
        renderVoicingList();
    };

    textarea.addEventListener('blur', () => commit(true));
    textarea.addEventListener('keydown', (e) => {
        // Enter(Shift 없이)로 저장, Shift+Enter는 줄바꿈 허용
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            textarea.blur(); // blur 핸들러에서 저장
        } else if (e.key === 'Escape') {
            e.preventDefault();
            commit(false);
        }
    });
}

// 🚀 보이싱 → 12키 연습 바로가기
//    저장된 보이싱의 chordQuality 만 선택하고, 12 base를 전부 활성화한 뒤 연습 화면으로 진입.
function startPracticeFromVoicing(v) {
    // 보이싱 저장은 'M'(메이저 트라이어드)을 M으로 저장하지만 practice pill은 data-val=""
    const targetType = v.chordQuality === 'M' ? '' : v.chordQuality;

    // 1) 12 base 전부 활성
    document.querySelectorAll('#root-pills .chord-pill').forEach(p => p.classList.add('active'));

    // 2) 연습 화면의 모든 quality pill 비활성 (voicing 화면의 pill은 건드리지 않음)
    document.querySelectorAll('#filter-panel .chord-pill[data-val]').forEach(p => p.classList.remove('active'));

    // 3) 해당 quality pill만 활성
    const typePill = document.querySelector(`#filter-panel .chord-pill[data-val="${targetType}"]`);
    if (typePill) {
        typePill.classList.add('active');
    } else {
        console.warn('No matching practice pill for quality:', v.chordQuality);
    }

    // 4) 내부 상태 동기화 + 저장
    updateFilters();

    // 5) 화면 전환: voicing → practice (home 건너뜀)
    document.getElementById('voicing-screen').classList.add('hidden');
    document.getElementById('practice-screen').classList.remove('hidden');

    // 6) 첫 코드 띄우고 라이트 생성
    initChords();
    createLights();
}

function highlightSelectedVoicingIfAny() {
    if (!currentlyHighlightedVoicingId) return;
    const v = cachedVoicings.find(x => x.id === currentlyHighlightedVoicingId);
    if (!v) return;
    voicingActiveMidiNotes = new Set(intervalsToMidiNotes(v.intervals));
    refreshKeyboardVisual();
}

// 현재 voicingSelectedQuality / voicingRootSemitone에 맞게 pill active 상태 동기화
// (외부 이벤트로 active가 꺼지는 경우에 대한 방어)
function syncVoicingPillActiveState() {
    document.querySelectorAll('.voicing-quality-group .chord-pill').forEach(p => {
        p.classList.toggle('active', p.getAttribute('data-val') === voicingSelectedQuality);
    });
    document.querySelectorAll('#voicing-root-pills .chord-pill').forEach(p => {
        p.classList.toggle('active', parseInt(p.getAttribute('data-semitone')) === voicingRootSemitone);
    });
}

// =====================================================================
// 🎹 Web MIDI API — 실제 MIDI 키보드 연결
// =====================================================================
// UX 원칙:
//   - MIDI Note On → 전부 릴리스 상태(midiHeldNotes 비어있음)에서 첫 키를 누르면
//     화면의 active 노트를 싹 비우고 새 코드 시작. 추가로 누르는 키는 그대로 쌓임.
//   - MIDI Note Off → midiHeldNotes에서만 빼고, 화면 active는 유지.
//     → 연주 → 릴리스 → 저장 / 다음 코드 연주... 흐름이 자연스러움.
let midiAccess = null;
let midiInputs = []; // 연결된 MIDIInput들
const midiHeldNotes = new Set(); // 현재 물리적으로 눌려있는 MIDI 노트들

function handleMIDIMessage(event) {
    const [status, note, velocity] = event.data;
    const cmd = status & 0xF0;
    // Note On (velocity > 0)
    if (cmd === 0x90 && velocity > 0) {
        // 전부 릴리스 상태에서 새로 누르는 첫 음이면 화면 초기화
        if (midiHeldNotes.size === 0) {
            voicingActiveMidiNotes.clear();
            currentlyHighlightedVoicingId = null;
        }
        midiHeldNotes.add(note);
        // 건반 범위 안에 있을 때만 화면 반영
        if (note >= KEYBOARD_START_MIDI && note <= KEYBOARD_END_MIDI) {
            voicingActiveMidiNotes.add(note);
            refreshKeyboardVisual();
            // 화면 밖 음이면 스크롤 조정
            scrollToMidiIfOffscreen(note);
        }
    }
    // Note Off (cmd 0x80, 또는 Note On with velocity 0)
    else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {
        midiHeldNotes.delete(note);
        // 화면 active는 유지 — 사용자가 저장할 수 있도록
    }
}

// 해당 MIDI 음이 현재 스크롤 영역 밖이면 살짝 스크롤해서 보이게
function scrollToMidiIfOffscreen(midi) {
    const kbEl = document.getElementById('piano-keyboard');
    if (!kbEl) return;
    const keyEl = kbEl.querySelector(`.piano-key[data-midi="${midi}"]`);
    if (!keyEl) return;
    const keyLeft = keyEl.offsetLeft;
    const keyRight = keyLeft + keyEl.offsetWidth;
    const viewLeft = kbEl.scrollLeft;
    const viewRight = viewLeft + kbEl.clientWidth;
    // 시야 밖이면 센터로
    if (keyLeft < viewLeft || keyRight > viewRight) {
        scrollKeyboardToMidi(midi);
    }
}

function setMIDIStatus(text, connected) {
    const statusEl = document.getElementById('midi-status');
    const btnEl = document.getElementById('midi-connect-btn');
    if (statusEl) {
        statusEl.textContent = text;
        statusEl.classList.toggle('connected', !!connected);
    }
    if (btnEl) {
        btnEl.classList.toggle('connected', !!connected);
        btnEl.textContent = connected ? 'MIDI Connected' : 'Connect MIDI';
    }
}

function attachMIDIInputs(access) {
    // 기존 input들의 리스너 해제
    midiInputs.forEach(inp => { inp.onmidimessage = null; });
    midiInputs = [];
    const names = [];
    for (const input of access.inputs.values()) {
        input.onmidimessage = handleMIDIMessage;
        midiInputs.push(input);
        names.push(input.name || 'MIDI Device');
    }
    if (midiInputs.length === 0) {
        setMIDIStatus('No MIDI device found', false);
    } else {
        setMIDIStatus(`Connected: ${names.join(', ')}`, true);
    }
}

async function connectMIDI() {
    if (!navigator.requestMIDIAccess) {
        setMIDIStatus('Web MIDI not supported in this browser', false);
        alert('This browser does not support Web MIDI. Try Chrome or Edge.');
        return;
    }
    try {
        setMIDIStatus('Requesting permission…', false);
        midiAccess = await navigator.requestMIDIAccess();
        attachMIDIInputs(midiAccess);
        // 디바이스 plug/unplug 대응
        midiAccess.onstatechange = () => attachMIDIInputs(midiAccess);
    } catch (err) {
        console.error('MIDI access failed:', err);
        setMIDIStatus('MIDI access denied', false);
    }
}

// Connect 버튼 바인딩
const midiBtn = document.getElementById('midi-connect-btn');
if (midiBtn) midiBtn.addEventListener('click', connectMIDI);

// --- 화면 전환 ---
document.getElementById('voicing-btn-home').addEventListener('click', () => {
    document.getElementById('home-screen').classList.add('hidden');
    document.getElementById('voicing-screen').classList.remove('hidden');
    syncVoicingPillActiveState(); // 🛡️ 진입 시 pill 상태 재확인
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

// 로그인 직후 저장된 보이싱 가져오기
window.addEventListener('user-settings-loaded', () => {
    if (!document.getElementById('voicing-screen').classList.contains('hidden')) {
        loadVoicingsForCurrentQuality();
    }
});

// 로그인/로그아웃 둘 다 반응 — Voicing 화면 열려있으면 리스트/빈 메시지 갱신
// (로그인 직후엔 'user-settings-loaded' 쪽에서도 load가 도니 중복 호출될 수 있지만 idempotent)
window.addEventListener('auth-state-changed', (e) => {
    const voicingScreen = document.getElementById('voicing-screen');
    if (!voicingScreen || voicingScreen.classList.contains('hidden')) return;
    if (e.detail && e.detail.signedIn) {
        loadVoicingsForCurrentQuality(); // 내 보이싱 불러오기
    } else {
        // 로그아웃: 캐시 비우고 빈 메시지 다시 렌더
        cachedVoicings = [];
        currentlyHighlightedVoicingId = null;
        renderVoicingList();
    }
});

// =====================================================================

// PWA 서비스 워커 등록
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js')
        .then(() => console.log('Service Worker Registered'));
}
