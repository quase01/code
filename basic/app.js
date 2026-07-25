/**
 * Science Quiz Explorer - 4th Grade Unit 4 (다양한 생물과 우리 생활)
 * Complete Application & Game Logic
 */

// --- 1. Sound Synthesizer via Web Audio API ---
class SoundManager {
    constructor() {
        this.enabled = true;
        this.ctx = null;
    }

    initCtx() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioCtx();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    playCorrect() {
        if (!this.enabled) return;
        this.initCtx();
        const now = this.ctx.currentTime;
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc1.type = 'sine';
        osc2.type = 'triangle';
        
        // E5 -> A5 (pleasant chime)
        osc1.frequency.setValueAtTime(659.25, now);
        osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15);
        osc2.frequency.setValueAtTime(659.25, now);
        osc2.frequency.exponentialRampToValueAtTime(880, now + 0.15);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.ctx.destination);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.4);
        osc2.stop(now + 0.4);
    }

    playWrong() {
        if (!this.enabled) return;
        this.initCtx();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.linearRampToValueAtTime(130, now + 0.25);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.3);
    }

    playFanfare() {
        if (!this.enabled) return;
        this.initCtx();
        const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
        notes.forEach((freq, idx) => {
            const now = this.ctx.currentTime + idx * 0.1;
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now);

            gain.gain.setValueAtTime(0.3, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start(now);
            osc.stop(now + 0.3);
        });
    }

    playClick() {
        if (!this.enabled) return;
        this.initCtx();
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.05);

        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.05);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.05);
    }
}

// --- 2. Full Question Database (Derived 100% from PDF Material) ---
const QUESTION_DATABASE = [
    // PART 1: MICROSCOPE
    {
        id: 'm1',
        category: 'microscope',
        categoryName: '실체 현미경',
        question: '실체 현미경에서 눈으로 보는 렌즈로 물체의 상을 확대하는 부분은 무엇인가요?',
        options: ['대물렌즈', '접안렌즈', '초점 조절 나사', '재물대'],
        answer: 1,
        explanation: '접안렌즈는 눈(眼)으로 직접 대고 보는 렌즈로 물체의 상을 확대합니다.'
    },
    {
        id: 'm2',
        category: 'microscope',
        categoryName: '실체 현미경',
        question: '실체 현미경에서 관찰 대상 쪽에 위치하여 물체의 상을 확대하는 렌즈는 무엇인가요?',
        options: ['접안렌즈', '대물렌즈', '회전판', '조명 조절 나사'],
        answer: 1,
        explanation: '대물렌즈는 관찰 대상(物) 쪽에 위치하는 렌즈입니다.'
    },
    {
        id: 'm3',
        category: 'microscope',
        categoryName: '실체 현미경',
        question: '실체 현미경을 사용할 때 상의 초점을 맞추기 위해 사용하는 부품은 무엇인가요?',
        options: ['초점 조절 나사', '조명 조절 나사', '회전판', '재물대'],
        answer: 0,
        explanation: '초점 조절 나사를 돌려 상의 초점을 뚜렷하게 맞춥니다.'
    },
    {
        id: 'm4',
        category: 'microscope',
        categoryName: '실체 현미경',
        question: '실체 현미경 사용 순서 중 첫 번째 단계로, 대물렌즈의 배율은 어떻게 정해야 할까요?',
        options: ['배율을 가장 높게 한다', '배율을 가장 낮게 한다', '중간 배율로 맞춘다', '배율은 상관없다'],
        answer: 1,
        explanation: '현미경 관찰 시에는 먼저 회전판을 돌려 대물렌즈의 배율을 가장 낮게 하고 시야를 확보해야 합니다.'
    },
    {
        id: 'm5',
        category: 'microscope',
        categoryName: '실체 현미경',
        question: '실체 현미경 사용 시 옆에서 관찰 대상을 보면서 초점 조절 나사로 내려주어야 하는 부분은?',
        options: ['접안렌즈', '대물렌즈', '조명', '재물대'],
        answer: 1,
        explanation: '렌즈와 관찰 대상이 부딪히지 않도록 옆에서 보면서 대물렌즈를 관찰 대상에 가깝게 내립니다.'
    },
    {
        id: 'm6',
        category: 'microscope',
        categoryName: '실체 현미경',
        question: '실체 현미경에서 대물렌즈의 배율을 조절할 때 돌리는 부분은 무엇인가요?',
        options: ['회전판', '재물대', '접안렌즈', '조명 조절 나사'],
        answer: 0,
        explanation: '회전판을 돌려서 원하는 배율의 대물렌즈를 선택합니다.'
    },

    // PART 2: FUNGI (버섯과 곰팡이)
    {
        id: 'f1',
        category: 'fungi',
        categoryName: '버섯과 곰팡이(균류)',
        question: '버섯과 곰팡이처럼 스스로 양분을 만들지 못하고 포자로 번식하는 생물 무리를 무엇이라고 하나요?',
        options: ['원생생물', '균류', '세균', '동물'],
        answer: 1,
        explanation: '버섯과 곰팡이는 균사로 이루어져 있고 포자로 번식하는 (균류)에 속합니다.'
    },
    {
        id: 'f2',
        category: 'fungi',
        categoryName: '버섯과 곰팡이(균류)',
        question: '버섯의 우산처럼 생긴 윗부분 안쪽에서 많이 관찰되는 구조는 무엇인가요?',
        options: ['알갱이', '주름', '마디', '나선'],
        answer: 1,
        explanation: '버섯의 갓(윗부분) 안쪽에는 줄지어 있는 많은 (주름)이 존재합니다.'
    },
    {
        id: 'f3',
        category: 'fungi',
        categoryName: '버섯과 곰팡이(균류)',
        question: '곰팡이를 돋보기나 실체 현미경으로 관찰했을 때 실 가닥 끝부분에 달린 둥근 것은 무엇인가요?',
        options: ['알갱이(포자주머니)', '나선 가닥', '털', '마디'],
        answer: 0,
        explanation: '곰팡이는 가늘고 긴 실 가닥 끝에 둥근 (알갱이)가 많이 달려 있습니다.'
    },
    {
        id: 'f4',
        category: 'fungi',
        categoryName: '버섯과 곰팡이(균류)',
        question: '균류가 잘 자라기에 가장 적당한 환경 조건은 무엇인가요?',
        options: ['차가운 햇빛이 잘 드는 곳', '따뜻하고 습한 곳', '매우 건조하고 바람부는 곳', '영하의 추운 환경'],
        answer: 1,
        explanation: '균류는 따뜻하고 습도가 높은 (습한 곳)에서 활발하게 잘 자랍니다.'
    },
    {
        id: 'f5',
        category: 'fungi',
        categoryName: '버섯과 곰팡이(균류)',
        question: '균류(버섯과 곰팡이)의 영양 섭취에 대한 설명 중 옳은 것은 무엇인가요?',
        options: ['식물처럼 햇빛을 받아 스스로 양분을 만든다', '스스로 양분을 만들지 못하고 죽은 생물이나 다른 생물에서 얻는다', '물을 마셔 영양분을 스스로 합성한다', '영양분 섭취가 필요 없다'],
        answer: 1,
        explanation: '균류는 엽록소가 없어 스스로 양분을 만들지 못하며, 다른 생물이나 죽은 생물에서 양분을 얻습니다.'
    },

    // PART 3: PROTISTS (해캄과 짚신벌레)
    {
        id: 'p1',
        category: 'protist',
        categoryName: '해캄과 짚신벌레(원생생물)',
        question: '해캄과 짚신벌레처럼 동물, 식물, 균류와 다른 생물 무리를 무엇이라고 하나요?',
        options: ['균류', '원생생물', '세균', '곤충'],
        answer: 1,
        explanation: '해캄, 짚신벌레, 미역, 김 등은 (원생생물)에 해당합니다.'
    },
    {
        id: 'p2',
        category: 'protist',
        categoryName: '해캄과 짚신벌레(원생생물)',
        question: '해캄을 관찰했을 때 볼 수 있는 특징으로 옳은 것은 무엇인가요?',
        options: ['길쭉한 둥근 모양에 바깥쪽에 털이 있다', '초록색의 실처럼 가는 나선 가닥이 여러 개 보인다', '공 모양으로 뭉쳐 움직인다', '막대 모양으로 생겼다'],
        answer: 1,
        explanation: '해캄은 초록색의 실처럼 가는 (나선) 가닥이 여러 개 보이고 대나무처럼 마디가 있습니다.'
    },
    {
        id: 'p3',
        category: 'protist',
        categoryName: '해캄과 짚신벌레(원생생물)',
        question: '짚신벌레의 생김새 특징으로 옳은 설명은 무엇인가요?',
        options: ['초록색 나선 가닥이 있다', '길쭉한 둥근 모양이고 바깥쪽에 가는 털이 보인다', '우산 모양처럼 생겼다', '마디로 이루어진 대나무 모양이다'],
        answer: 1,
        explanation: '짚신벌레는 길쭉한 둥근 모양이며 바깥쪽에 섬모(가는 털)가 있습니다.'
    },
    {
        id: 'p4',
        category: 'protist',
        categoryName: '해캄과 짚신벌레(원생생물)',
        question: '다음 중 바다에 사는 원생생물에 해당하는 것은 무엇인가요?',
        options: ['해캄', '짚신벌레', '미역, 다시마, 김', '종벌레'],
        answer: 2,
        explanation: '미역, 다시마, 김 등은 바다에 사는 다세포 원생생물입니다.'
    },
    {
        id: 'p5',
        category: 'protist',
        categoryName: '해캄과 짚신벌레(원생생물)',
        question: '논, 연못, 하천 등에 살고 있는 원생생물의 예시가 아닌 것은 무엇인가요?',
        options: ['유글레나', '종벌레', '반달말', '독버섯'],
        answer: 3,
        explanation: '독버섯은 균류이며, 유글레나, 종벌레, 반달말, 해캄, 짚신벌레는 하천이나 연못의 원생생물입니다.'
    },

    // PART 4: BACTERIA & LIFE SCIENCE (세균 및 우리 생활)
    {
        id: 'b1',
        category: 'bacteria',
        categoryName: '세균과 우리 생활',
        question: '세균의 생김새에 따른 분류에 해당하지 않는 것은 무엇인가요?',
        options: ['공 모양 세균', '막대 모양 세균', '나선 모양 세균', '우산 모양 세균'],
        answer: 3,
        explanation: '세균은 생김새에 따라 공 모양, 막대 모양, 나선 모양 세균 등으로 분류됩니다.'
    },
    {
        id: 'b2',
        category: 'bacteria',
        categoryName: '세균과 우리 생활',
        question: '세균의 특징에 대한 설명으로 올바른 것은 무엇인가요?',
        options: ['크기가 매우 커서 맨눈으로 쉽게 본다', '생김새가 복잡하고 거대하다', '살기 적당한 조건이 되면 많은 수로 빠르게 번식한다', '땅 속에는 세균이 살지 않는다'],
        answer: 2,
        explanation: '세균은 크기가 매우 작고 생김새가 단순하지만 적당한 조건에서 매우 빠르게 번식합니다.'
    },
    {
        id: 'b3',
        category: 'bacteria',
        categoryName: '세균과 우리 생활',
        question: '균류와 세균이 우리 생활에 주는 이로운 영향에 해당하는 것은?',
        options: ['죽은 생물을 분해해 자연으로 돌려보낸다', '음식을 빨리 상하게 한다', '물건을 부식시킨다', '적조 현상을 일으킨다'],
        answer: 0,
        explanation: '균류와 세균은 생태계에서 죽은 생물이나 배설물을 분해하는 매우 중요한 역할을 합니다.'
    },
    {
        id: 'b4',
        category: 'bacteria',
        categoryName: '세균과 우리 생활',
        question: '일부 원생생물의 수가 바다나 하천에서 급격히 많아져 수질이 붉게 변하는 해로운 현상은?',
        options: ['녹조 현상', '적조 현상', '분해 현상', '포자 현상'],
        answer: 1,
        explanation: '일부 원생생물이 과도하게 늘어나면 바다나 호수가 붉게 변하는 (적조) 현상이 나타납니다.'
    },
    {
        id: 'b5',
        category: 'bacteria',
        categoryName: '세균과 우리 생활',
        question: '곤충을 죽게 하는 균류의 특징을 이용해 농작물의 해충을 막는 생명 과학 응용 제품은?',
        options: ['생물 연료', '생물 농약', '하수 처리제', '항생제'],
        answer: 1,
        explanation: '곤충에 병을 일으키는 균류를 이용해 친환경적인 (생물 농약)을 개발합니다.'
    },
    {
        id: 'b6',
        category: 'bacteria',
        categoryName: '세균과 우리 생활',
        question: '세균을 자라지 못하게 하는 균류(예: 푸른곰팡이)의 성분을 이용해 만드는 의약품은?',
        options: ['질병 치료 약 (항생제)', '생물 연료', '합성 세제', '건강보조식품'],
        answer: 0,
        explanation: '세균 증식을 억제하는 균류 성분으로 페니실린 같은 (질병 치료 약/항생제)을 만듭니다.'
    }
];

// --- 3. Sorting Game Organism List ---
const SORTING_ORGANISMS = [
    { name: '버섯', category: '균류', emoji: '🍄', desc: '갓 아래 주름이 있고 포자로 번식함' },
    { name: '곰팡이', category: '균류', emoji: '🍞', desc: '실 가닥 끝에 둥근 알갱이가 달림' },
    { name: '해캄', category: '원생생물', emoji: '🌿', desc: '초록색 실 모양 나선 가닥이 존재함' },
    { name: '짚신벌레', category: '원생생물', emoji: '🦠', desc: '길쭉한 모양에 바깥쪽에 가는 털이 있음' },
    { name: '공 모양 세균', category: '세균', emoji: '🔴', desc: '동글동글한 매우 작은 미생물' },
    { name: '막대 모양 세균', category: '세균', emoji: '💊', desc: '길쭉한 막대 모양의 미생물' },
    { name: '나선 모양 세균', category: '세균', emoji: '🌀', desc: '구부러진 나선 모양의 미생물' },
    { name: '미역', category: '원생생물', emoji: '🌊', desc: '바다에 사는 원생생물' },
    { name: '유글레나', category: '원생생물', emoji: '💧', desc: '연못이나 하천에 사는 원생생물' },
    { name: '종벌레', category: '원생생물', emoji: '🔔', desc: '하천에 사는 종 모양의 원생생물' }
];

// --- 4. Main Game State & Logic ---
class GameApp {
    constructor() {
        this.sound = new SoundManager();
        
        // User cumulative state
        this.totalScore = parseInt(localStorage.getItem('sci_totalScore') || '0');
        this.maxCombo = parseInt(localStorage.getItem('sci_maxCombo') || '0');
        this.unlockedBadges = JSON.parse(localStorage.getItem('sci_unlockedBadges') || '[]');

        // Quiz State
        this.currentQuizList = [];
        this.currentQIndex = 0;
        this.quizScore = 0;
        this.comboStreak = 0;
        this.maxQuizCombo = 0;
        this.userAnswers = [];

        // Lab state
        this.labCurrentPartIndex = 0;
        this.labPartQuestions = [
            { target: '접안렌즈', desc: '"눈으로 보는 렌즈로 물체의 상을 확대한다."' },
            { target: '대물렌즈', desc: '"관찰 대상 쪽에 위치하여 상을 확대하는 렌즈이다."' },
            { target: '초점 조절 나사', desc: '"상의 초점을 맞출 때 사용하는 나사이다."' },
            { target: '조명 조절 나사', desc: '"조명을 켜고 끄며 밝기를 조절하는 나사이다."' },
            { target: '재물대', desc: '"관찰 대상을 올려놓는 받침대이다."' },
            { target: '회전판', desc: '"대물렌즈의 배율을 조절하는 나사판이다."' }
        ];

        this.stepsCorrectOrder = [
            '① 회전판을 돌려 대물렌즈 배율을 가장 낮게 하고 재물대에 올려놓기',
            '② 전원을 켜고 조명 조절 나사로 빛의 밝기 조절하기',
            '③ 옆에서 보면서 초점 조절 나사로 대물렌즈를 관찰 대상에 가깝게 내리기',
            '④ 접안렌즈를 보며 대물렌즈를 천천히 올려 초점 맞추기'
        ];
        this.userStepsSlots = [null, null, null, null];
        this.selectedStepCardIndex = null;

        // Sorting Game State
        this.sortQueue = [];
        this.sortIndex = 0;
        this.sortScore = 0;

        this.init();
    }

    init() {
        this.updateStatsUI();
        this.setupEventListeners();
        this.initStepsPuzzle();
    }

    setupEventListeners() {
        // Sound toggle
        const soundBtn = document.getElementById('sound-toggle-btn');
        if (soundBtn) {
            soundBtn.addEventListener('click', () => {
                this.sound.enabled = !this.sound.enabled;
                soundBtn.textContent = this.sound.enabled ? '🔊' : '🔇';
            });
        }

        // Navigation links
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.target.getAttribute('data-target');
                this.showScreen(target);
                this.sound.playClick();
            });
        });
    }

    updateStatsUI() {
        document.getElementById('stat-total-score').textContent = this.totalScore;
        document.getElementById('stat-max-combo').textContent = this.maxCombo;
        document.getElementById('stat-badge-count').textContent = `${this.unlockedBadges.length} / 6`;
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const targetScreen = document.getElementById(`screen-${screenId}`);
        if (targetScreen) {
            targetScreen.classList.add('active');
        }

        // Update nav active state
        document.querySelectorAll('.nav-btn').forEach(b => {
            if (b.getAttribute('data-target') === screenId) {
                b.classList.add('active');
            } else {
                b.classList.remove('active');
            }
        });

        // Specific screen init
        if (screenId === 'sorting-game') {
            this.startSortingGame();
        } else if (screenId === 'microscope-lab') {
            this.setupLabPartQuestion();
        }
    }

    // --- QUIZ LOGIC ---
    startQuiz(category) {
        let pool = [];
        if (category === 'all') {
            pool = [...QUESTION_DATABASE];
        } else {
            pool = QUESTION_DATABASE.filter(q => q.category === category);
        }

        // Shuffle questions
        this.currentQuizList = pool.sort(() => Math.random() - 0.5);
        this.currentQIndex = 0;
        this.quizScore = 0;
        this.comboStreak = 0;
        this.maxQuizCombo = 0;
        this.userAnswers = [];

        this.showScreen('quiz-play');
        this.renderQuestion();
    }

    renderQuestion() {
        const q = this.currentQuizList[this.currentQIndex];
        const total = this.currentQuizList.length;

        // Progress bar
        const pct = ((this.currentQIndex + 1) / total) * 100;
        document.getElementById('quiz-progress-fill').style.width = `${pct}%`;
        document.getElementById('quiz-step-counter').textContent = `문제 ${this.currentQIndex + 1} / ${total}`;
        document.getElementById('quiz-current-score').textContent = this.quizScore;

        // Combo display
        const comboDisplay = document.getElementById('quiz-combo-display');
        if (this.comboStreak >= 2) {
            comboDisplay.style.display = 'inline-block';
            document.getElementById('quiz-combo-count').textContent = this.comboStreak;
        } else {
            comboDisplay.style.display = 'none';
        }

        // Question Details
        document.getElementById('question-category-tag').textContent = q.categoryName;
        document.getElementById('question-text').textContent = q.question;

        // Hide explanation box
        document.getElementById('explanation-box').style.display = 'none';

        // Options
        const container = document.getElementById('options-container');
        container.innerHTML = '';

        q.options.forEach((optText, idx) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.innerHTML = `
                <span class="opt-num">${idx + 1}</span>
                <span>${optText}</span>
            `;
            btn.onclick = () => this.selectOption(idx);
            container.appendChild(btn);
        });
    }

    selectOption(selectedIndex) {
        const q = this.currentQuizList[this.currentQIndex];
        const optionsBtns = document.querySelectorAll('.option-btn');
        optionsBtns.forEach(btn => btn.disabled = true);

        const isCorrect = selectedIndex === q.answer;
        this.userAnswers.push({ question: q, userIdx: selectedIndex, isCorrect });

        if (isCorrect) {
            this.sound.playCorrect();
            optionsBtns[selectedIndex].classList.add('correct');
            this.comboStreak++;
            if (this.comboStreak > this.maxQuizCombo) {
                this.maxQuizCombo = this.comboStreak;
            }
            if (this.comboStreak > this.maxCombo) {
                this.maxCombo = this.comboStreak;
                localStorage.setItem('sci_maxCombo', this.maxCombo);
            }

            const points = 10 + (this.comboStreak >= 2 ? (this.comboStreak - 1) * 5 : 0);
            this.quizScore += points;
            
            document.getElementById('result-status-title').innerHTML = '⭕ 정답입니다! 👏';
            document.getElementById('result-status-title').style.color = '#166534';
        } else {
            this.sound.playWrong();
            optionsBtns[selectedIndex].classList.add('wrong');
            optionsBtns[q.answer].classList.add('correct');
            this.comboStreak = 0;

            document.getElementById('result-status-title').innerHTML = '❌ 아쉽네요!';
            document.getElementById('result-status-title').style.color = '#991b1b';
        }

        // Show Explanation
        document.getElementById('explanation-text').textContent = q.explanation;
        document.getElementById('explanation-box').style.display = 'block';

        this.updateStatsUI();
    }

    nextQuestion() {
        this.sound.playClick();
        this.currentQIndex++;
        if (this.currentQIndex < this.currentQuizList.length) {
            this.renderQuestion();
        } else {
            this.finishQuiz();
        }
    }

    finishQuiz() {
        this.totalScore += this.quizScore;
        localStorage.setItem('sci_totalScore', this.totalScore);
        this.updateStatsUI();

        const total = this.currentQuizList.length;
        const correctCount = this.userAnswers.filter(a => a.isCorrect).length;
        const accuracy = Math.round((correctCount / total) * 100);

        document.getElementById('res-score').textContent = this.quizScore;
        document.getElementById('res-accuracy').textContent = `${accuracy}%`;
        document.getElementById('res-combo').textContent = this.maxQuizCombo;

        // Check badge unlocks
        let newBadge = null;
        if (accuracy === 100 && !this.unlockedBadges.includes('perfect')) {
            newBadge = { id: 'perfect', icon: '👑', title: '만점 왕관', desc: '퀴즈에서 100점 만점을 달성했습니다!' };
            this.unlockedBadges.push('perfect');
        } else if (this.maxQuizCombo >= 5 && !this.unlockedBadges.includes('combo_5')) {
            newBadge = { id: 'combo_5', icon: '🔥', title: '연속 정답 폭주', desc: '5연속 정답 콤보를 달성했습니다!' };
            this.unlockedBadges.push('combo_5');
        } else if (this.totalScore >= 100 && !this.unlockedBadges.includes('score_100')) {
            newBadge = { id: 'score_100', icon: '🔬', title: '과학 마스터', desc: '누적 점수 100점을 돌파했습니다!' };
            this.unlockedBadges.push('score_100');
        }

        localStorage.setItem('sci_unlockedBadges', JSON.stringify(this.unlockedBadges));
        this.updateStatsUI();

        if (newBadge) {
            this.sound.playFanfare();
            document.getElementById('badge-unlocked-banner').style.display = 'flex';
            document.getElementById('unlocked-b-icon').textContent = newBadge.icon;
            document.getElementById('unlocked-b-title').textContent = newBadge.title;
            document.getElementById('unlocked-b-desc').textContent = newBadge.desc;
        } else {
            document.getElementById('badge-unlocked-banner').style.display = 'none';
            this.sound.playCorrect();
        }

        // Review list for wrong answers
        const wrongAnswers = this.userAnswers.filter(a => !a.isCorrect);
        const reviewBox = document.getElementById('review-questions-box');
        const reviewList = document.getElementById('review-list-container');

        if (wrongAnswers.length > 0) {
            reviewBox.style.display = 'block';
            reviewList.innerHTML = wrongAnswers.map(item => `
                <div class="review-item">
                    <strong>Q. ${item.question.question}</strong><br>
                    <span style="color: #ef4444;">내 답: ${item.question.options[item.userIdx]}</span> | 
                    <span style="color: #10b981;">정답: ${item.question.options[item.question.answer]}</span><br>
                    <small style="color:#64748b;">💡 ${item.question.explanation}</small>
                </div>
            `).join('');
        } else {
            reviewBox.style.display = 'none';
        }

        this.showScreen('quiz-result');
    }

    restartCurrentQuiz() {
        this.startQuiz('all');
    }

    // --- MICROSCOPE LAB LOGIC ---
    switchLabTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.lab-content').forEach(c => c.classList.remove('active'));

        if (tab === 'parts') {
            document.querySelectorAll('.tab-btn')[0].classList.add('active');
            document.getElementById('lab-tab-parts').classList.add('active');
            this.setupLabPartQuestion();
        } else {
            document.querySelectorAll('.tab-btn')[1].classList.add('active');
            document.getElementById('lab-tab-steps').classList.add('active');
        }
        this.sound.playClick();
    }

    setupLabPartQuestion() {
        this.labCurrentPartIndex = Math.floor(Math.random() * this.labPartQuestions.length);
        const q = this.labPartQuestions[this.labCurrentPartIndex];
        document.getElementById('lab-part-desc').textContent = q.desc;
        document.getElementById('lab-part-feedback').style.display = 'none';
    }

    answerPartName(selectedPart) {
        const q = this.labPartQuestions[this.labCurrentPartIndex];
        const feedback = document.getElementById('lab-part-feedback');
        feedback.style.display = 'block';

        if (selectedPart === q.target) {
            this.sound.playCorrect();
            feedback.innerHTML = `<span style="color:#10b981; font-weight:bold;">⭕ 딩동댕! 올바른 부위입니다: [${q.target}]</span>`;
            setTimeout(() => this.setupLabPartQuestion(), 1500);
        } else {
            this.sound.playWrong();
            feedback.innerHTML = `<span style="color:#ef4444; font-weight:bold;">❌ 아쉬워요! 다시 생각해보세요.</span>`;
        }
    }

    selectPartHotspot(partName) {
        this.answerPartName(partName);
    }

    // Microscope Steps Puzzle
    initStepsPuzzle() {
        this.userStepsSlots = [null, null, null, null];
        const pool = document.getElementById('steps-pool');
        if (!pool) return;

        // Shuffle cards
        const shuffled = [...this.stepsCorrectOrder].sort(() => Math.random() - 0.5);

        pool.innerHTML = '';
        shuffled.forEach((text, idx) => {
            const card = document.createElement('div');
            card.className = 'step-card';
            card.textContent = text;
            card.setAttribute('data-original-idx', idx);
            card.onclick = () => this.handleStepCardClick(card, text);
            pool.appendChild(card);
        });

        this.renderStepSlots();
    }

    handleStepCardClick(cardElem, text) {
        this.sound.playClick();
        // Check if already in a slot
        const existingSlot = this.userStepsSlots.indexOf(text);
        if (existingSlot !== -1) {
            // Remove from slot
            this.userStepsSlots[existingSlot] = null;
            cardElem.classList.remove('selected');
        } else {
            // Place into first empty slot
            const emptyIdx = this.userStepsSlots.indexOf(null);
            if (emptyIdx !== -1) {
                this.userStepsSlots[emptyIdx] = text;
                cardElem.classList.add('selected');
            }
        }
        this.renderStepSlots();
    }

    renderStepSlots() {
        for (let i = 0; i < 4; i++) {
            const holder = document.getElementById(`slot-${i + 1}`);
            if (holder) {
                if (this.userStepsSlots[i]) {
                    holder.innerHTML = `<div class="step-card" style="margin:0; width:100%;">${this.userStepsSlots[i]}</div>`;
                } else {
                    holder.innerHTML = `<span style="color:#94a3b8; font-size:0.85rem;">카드를 클릭해 배치</span>`;
                }
            }
        }
    }

    checkStepsOrder() {
        const msg = document.getElementById('steps-result-msg');
        msg.style.display = 'block';

        let isCorrect = true;
        for (let i = 0; i < 4; i++) {
            if (this.userStepsSlots[i] !== this.stepsCorrectOrder[i]) {
                isCorrect = false;
                break;
            }
        }

        if (isCorrect) {
            this.sound.playFanfare();
            msg.innerHTML = '<span style="color:#10b981;">🎉 완벽합니다! 실체 현미경 올바른 사용 순서 1~4단계를 모두 맞추셨습니다! 👏</span>';
        } else {
            this.sound.playWrong();
            msg.innerHTML = '<span style="color:#ef4444;">❌ 순서가 맞지 않습니다. ① 배율 낮게 ➔ ② 조명 켜기 ➔ ③ 대물렌즈 내리기 ➔ ④ 천천히 올리며 초점 맞추기 순서로 맞춰보세요.</span>';
        }
    }

    resetStepsOrder() {
        this.sound.playClick();
        document.getElementById('steps-result-msg').style.display = 'none';
        this.initStepsPuzzle();
    }

    // --- SORTING GAME LOGIC ---
    startSortingGame() {
        this.sortQueue = [...SORTING_ORGANISMS].sort(() => Math.random() - 0.5);
        this.sortIndex = 0;
        this.sortScore = 0;

        document.getElementById('sort-score').textContent = '0';
        document.getElementById('sort-feedback').style.display = 'none';
        this.renderSortCard();
    }

    renderSortCard() {
        const left = this.sortQueue.length - this.sortIndex;
        document.getElementById('sort-cards-left').textContent = left;

        if (this.sortIndex >= this.sortQueue.length) {
            // Finished
            this.sound.playFanfare();
            document.getElementById('current-organism-card').innerHTML = `
                <div class="org-emoji">🏆</div>
                <h3 class="org-name">분류 완료!</h3>
                <p class="org-desc">총 점수: ${this.sortScore}점</p>
            `;
            return;
        }

        const org = this.sortQueue[this.sortIndex];
        document.getElementById('org-emoji').textContent = org.emoji;
        document.getElementById('org-name').textContent = org.name;
        document.getElementById('org-desc').textContent = org.desc;
    }

    sortCurrentOrganism(targetCategory) {
        if (this.sortIndex >= this.sortQueue.length) return;

        const currentOrg = this.sortQueue[this.sortIndex];
        const feedback = document.getElementById('sort-feedback');
        feedback.style.display = 'block';

        if (currentOrg.category === targetCategory) {
            this.sound.playCorrect();
            this.sortScore += 10;
            document.getElementById('sort-score').textContent = this.sortScore;
            feedback.innerHTML = `<span style="color:#10b981;">⭕ 딩동댕! [${currentOrg.name}]은(는) ${targetCategory}입니다!</span>`;
        } else {
            this.sound.playWrong();
            feedback.innerHTML = `<span style="color:#ef4444;">❌ 틀렸습니다! [${currentOrg.name}]은(는) [${currentOrg.category}]에 속합니다.</span>`;
        }

        this.sortIndex++;
        setTimeout(() => {
            feedback.style.display = 'none';
            this.renderSortCard();
        }, 1200);
    }

    // --- STUDY NOTE BLANKS TOGGLE ---
    toggleBlankAnswers(showAll) {
        this.sound.playClick();
        document.querySelectorAll('.blank-word').forEach(w => {
            if (showAll) {
                w.classList.add('revealed');
            } else {
                w.classList.remove('revealed');
            }
        });
    }
}

// Global game instance
let game = null;

window.addEventListener('DOMContentLoaded', () => {
    game = new GameApp();
});
