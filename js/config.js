// 공개되어도 괜찮은 설정만 둠. 접속 키(ACCESS_KEY)는 브라우저 localStorage에만 저장.
export const WORKER_URL = "https://my-nikke.dry-truth-b7fa.workers.dev";

export const ACCOUNTS = ["케니", "키니시", "키니", "키치", "키시", "키키", "케니피"];

// 가챠 트래커와 같은 Firebase 프로젝트를 쓰고, 도감은 roster 컬렉션에 계정별 문서로 저장
export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyCy0S0zr62mqucR02wE6eqqj_z4GjbjKpY",
    authDomain: "nikke-gacha-69684.firebaseapp.com",
    projectId: "nikke-gacha-69684",
    storageBucket: "nikke-gacha-69684.firebasestorage.app",
    messagingSenderId: "364912880739",
    appId: "1:364912880739:web:6c5c4604b8894883be1c56",
};

// 허브 탭에 그대로 띄우는 기존 사이트들
export const EXTERNAL_TABS = {
};
