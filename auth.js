// =====================================================================
// PracticeChords.io — Firebase 인증 모듈
// 구글 로그인/로그아웃, 5분 자동 로그아웃 타이머
// 주의: 이 파일은 index.html에서 <script type="module">로 로드되어야 합니다
// =====================================================================

// 1. 필요한 Firebase 라이브러리 불러오기
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp, collection, addDoc, getDocs, deleteDoc, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 2. 본인의 Firebase 설정
const firebaseConfig = {
    apiKey: "AIzaSyCk7MXi47DNq7K7PhFIr5BT4uBwC39N_h8",
    authDomain: "practicechords.io",
    projectId: "practice-chords",
    storageBucket: "practice-chords.firebasestorage.app",
    messagingSenderId: "823815682850",
    appId: "1:823815682850:web:4097954afe623c7671437b",
    measurementId: "G-GDNV4ZCVQ4"
};

// 3. Firebase 초기화
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);
const db = getFirestore(app);

// =====================================================================
// 💾 Firestore: 사용자별 코드 선택/가중치 저장 & 불러오기
// =====================================================================
// 저장 위치: users/{uid}
// 저장 형태: { selectedRoots, selectedTypes, chordWeights, updatedAt }

// 외부(app.js)에서 호출할 저장 함수. 로그인 안 돼 있으면 조용히 무시.
window.saveChordSettings = async (settings) => {
    if (!auth.currentUser) return; // 로그인 안 된 상태면 저장 안 함
    try {
        const userDocRef = doc(db, "users", auth.currentUser.uid);
        await setDoc(userDocRef, {
            ...settings,
            updatedAt: serverTimestamp()
        }, { merge: true });
    } catch (error) {
        console.error("Failed to save settings:", error);
    }
};

// 로그인 직후 사용자 문서 불러와서 app.js로 이벤트 전달
const loadAndDispatchSettings = async (uid) => {
    try {
        const userDocRef = doc(db, "users", uid);
        const snap = await getDoc(userDocRef);
        if (snap.exists()) {
            const data = snap.data();
            window.dispatchEvent(new CustomEvent("user-settings-loaded", {
                detail: data
            }));
        }
    } catch (error) {
        console.error("Failed to load settings:", error);
    }
};

// =====================================================================
// 🎹 보이싱 라이브러리 Firestore 함수들
// 저장 경로: users/{uid}/voicings/{voicingId}
// 문서 형태: { chordQuality: "m7", intervals: [0,3,7,10], createdAt: timestamp }
// =====================================================================

window.saveVoicing = async (voicing) => {
    if (!auth.currentUser) throw new Error("Not signed in");
    const voicingsCol = collection(db, "users", auth.currentUser.uid, "voicings");
    await addDoc(voicingsCol, {
        chordQuality: voicing.chordQuality,
        intervals: voicing.intervals,
        createdAt: serverTimestamp()
    });
};

window.loadVoicings = async (chordQuality) => {
    if (!auth.currentUser) return [];
    const voicingsCol = collection(db, "users", auth.currentUser.uid, "voicings");
    // chordQuality로 필터 + 최신순 정렬
    const q = query(voicingsCol, where("chordQuality", "==", chordQuality), orderBy("createdAt", "desc"));
    try {
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (err) {
        // orderBy + where 조합은 복합 인덱스가 필요할 수 있음 — fallback: 필터만 하고 클라이언트에서 정렬
        console.warn("Voicings query with orderBy failed, falling back:", err);
        const q2 = query(voicingsCol, where("chordQuality", "==", chordQuality));
        const snap2 = await getDocs(q2);
        const rows = snap2.docs.map(d => ({ id: d.id, ...d.data() }));
        rows.sort((a, b) => {
            const at = a.createdAt?.seconds || 0;
            const bt = b.createdAt?.seconds || 0;
            return bt - at; // 최신순
        });
        return rows;
    }
};

window.deleteVoicing = async (voicingId) => {
    if (!auth.currentUser) throw new Error("Not signed in");
    const docRef = doc(db, "users", auth.currentUser.uid, "voicings", voicingId);
    await deleteDoc(docRef);
};
// =====================================================================

// 구글 제공업체 설정 (무조건 계정 선택 창 띄우기 추가!)
const provider = new GoogleAuthProvider();
provider.setCustomParameters({
    prompt: 'select_account'
});

// 4. 구글 로그인/로그아웃 함수
window.handleAuth = () => {
    if (!auth.currentUser) {
        // 로그인 안 된 상태면 팝업 띄우기
        signInWithPopup(auth, provider)
            .then((result) => alert("Signed in successfully!"))
            .catch((error) => console.error("Sign-in failed.:", error));
    } else {
        // 로그인 된 상태면 로그아웃
        signOut(auth).then(() => alert("Signed out successfully."));
    }
};

// =====================================================================
// ⏰ 5분 자동 로그아웃 로직 (순수 자바스크립트 버전)
// =====================================================================
const TIMEOUT_MS = 5 * 60 * 1000; // 5분 = 300,000 밀리초

const checkSessionTimeout = () => {
    const lastActive = localStorage.getItem("lastActiveTime");

    if (lastActive) {
        const timePassed = Date.now() - parseInt(lastActive, 10);

        if (timePassed > TIMEOUT_MS) {
            signOut(auth).then(() => {
                localStorage.removeItem("lastActiveTime");
                alert("Signed out due to inactivity (5 minutes).");
                window.location.reload(); // 쫓아내고 새로고침
            }).catch((error) => console.error(error));
        }
    }
};

// 🚀 30초에 한 번만 localStorage에 쓰도록 스로틀 적용 (성능 최적화)
let lastWriteTime = 0;
const WRITE_THROTTLE_MS = 30 * 1000; // 30초

const updateActivityTime = () => {
    if (!auth.currentUser) return;
    const now = Date.now();
    if (now - lastWriteTime < WRITE_THROTTLE_MS) return; // 너무 자주 쓰지 않기
    lastWriteTime = now;
    localStorage.setItem("lastActiveTime", now.toString());
};

// 접속 시 시간 체크
checkSessionTimeout();

// 움직임 감지 시 시간 갱신
window.addEventListener("mousemove", updateActivityTime);
window.addEventListener("keydown", updateActivityTime);
window.addEventListener("click", updateActivityTime);
window.addEventListener("beforeunload", updateActivityTime);
// =====================================================================


// 5. 로그인 상태 감시 및 버튼 UI 변경
const signinBtn = document.getElementById('signin-btn');
onAuthStateChanged(auth, (user) => {
    if (user) {
        // 로그인 성공 시
        signinBtn.innerText = `${user.displayName.split(' ')[0]} (SIGN OUT)`;
        updateActivityTime(); // 타이머 시작
        loadAndDispatchSettings(user.uid); // 🚀 저장된 코드 설정 불러오기
    } else {
        // 로그아웃 상태 시
        signinBtn.innerText = "SIGN IN";
        localStorage.removeItem("lastActiveTime"); // 타이머 기록 삭제
    }
});
