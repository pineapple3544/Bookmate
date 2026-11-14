const defaultHair = ["#352d30", "#493a2c", "#242e37", "#59463c"];
const defaultClothes = ["#8da99b", "#b58b72", "#819bb1", "#b7a6c7"];

const hairColors = {
  ink: "#30282c", chestnut: "#754e3a", honey: "#c69a55", plum: "#735476",
  silver: "#cbd5dd", coral: "#d77372", copper: "#a74c39", ocean: "#4671a1",
  moss: "#688b5d", lavender: "#ae8cce", cream: "#f0dfb7", pink: "#d890b4",
};
const skinColors = {
  peach: "#efd0b4", sand: "#d6af8d", bronze: "#ae7959", umber: "#754d3c",
  lime: "#a4c65d", red: "#d26d72", gray: "#9da5ad", blue: "#78a6da", violet: "#ad8ccc",
};
const clothesColors = {
  mint: "#8da99b", rose: "#cb8595", sky: "#819bb1", lilac: "#b7a6c7",
  amber: "#dab16a", ivory: "#ece0cb", navy: "#455a78", red: "#ad5866",
};
const shoeColors = {
  ink: "#272d30", cream: "#e9dfc7", brown: "#755245", red: "#b95c65",
  blue: "#536ea2", mint: "#79a696",
};
const legColors = {
  trousers: "#39454a", jeans: "#4d6f99", black: "#2b2b36", denim: "#7b9abd",
  shorts: "#a67f62", joggers: "#66677d", skirt: "#ae718e",
};

const hairstyles = {
  short: "기본", crop: "스포츠", spikes: "뾰족 머리", side: "가르마",
  ponytail: "포니테일", twinBuns: "뿌까", bun: "똥머리", ringlets: "곱슬",
  afro: "폭탄 머리", longCurls: "곱슬 장발", waves: "웨이브 장발",
  mohawk: "모히칸", bowl: "바가지", antenna: "더듬이",
  fringeLong: "앞머리 장발", fringeShort: "앞머리 숏", bald: "민머리",
  bob: "단발", long: "장발", braids: "땋은 머리", pigtails: "양갈래",
};
const tops = {
  tee: "반소매", longSleeve: "긴소매", tie: "셔츠와 넥타이", tank: "나시", knit: "니트", uniform: "유니폼",
  stripedTee: "줄무늬 티", cardigan: "가디건", puffer: "패딩", coat: "코트",
  denimJacket: "자켓", dress: "원피스", varsity: "과잠", vest: "조끼",
  pajamas: "잠옷", hoodie: "후드티", shirt: "셔츠", frog: "개구리",
  witch: "마녀", vampire: "드라큘라", snowWhite: "백설공주",
  hanbok: "한복", santa: "크리스마스 산타", school: "교복", ghost: "유령",
  mermaid: "인어공주", strawberry: "딸기", octopus: "문어",
  bear: "곰", penguin: "펭귄", shark: "상어", jellyfish: "해파리", pirate: "해적",
  watermelon: "수박", pumpkin: "호박", skeleton: "해골", reindeer: "루돌프", chef: "요리사",
  doctor: "의사", astronaut: "우주복", knight: "기사 갑옷", detective: "탐정",
};
const baseball = {
  lg: ["LG 트윈스", "#e8e4e5", "#a51b48", "#292735", true],
  hanwha: ["한화 이글스", "#e78740", "#322a35", "#e5dfd5"],
  ssg: ["SSG 랜더스", "#df595d", "#893343", "#f5deb4"],
  samsung: ["삼성 라이온즈", "#5488d1", "#244c91", "#f6f4ef"],
  nc: ["NC 다이노스", "#334765", "#c6a779", "#f0e5cf"],
  kt: ["KT 위즈", "#383742", "#df4c60", "#f4eee8"],
  lotte: ["롯데 자이언츠", "#e1e6e8", "#294160", "#b55061"],
  kia: ["KIA 타이거즈", "#eae2e2", "#d64650", "#2e344b"],
  doosan: ["두산 베어스", "#3d4d71", "#d45662", "#f1e5e0"],
  kiwoom: ["키움 히어로즈", "#76374e", "#b86c81", "#eee0d9"],
};
const costumes = {
  frog: { shirt: "#6caa64", legs: "#557f4d", shoes: "#405d3d" },
  witch: { shirt: "#483653", legs: "#392b48", shoes: "#2b233a" },
  vampire: { shirt: "#3d303c", legs: "#34303b", shoes: "#272432" },
  snowWhite: { shirt: "#416da5", legs: "#e5b44f", shoes: "#b45960" },
  hanbok: { shirt: "#eac3a5", legs: "#bb596f", shoes: "#80516d", bottom: "skirt" },
  santa: { shirt: "#bc3f50", legs: "#ad3948", shoes: "#392a33" },
  school: { shirt: "#3b5275", legs: "#68758e", shoes: "#392e3b", bottom: "skirt" },
  ghost: { shirt: "#e8e4f7", coversLegs: true },
  mermaid: { shirt: "#976db9", coversLegs: true },
  strawberry: { shirt: "#d65168", legs: "#ac384e", shoes: "#813849" },
  octopus: { shirt: "#bd76a7", coversLegs: true },
  bear: { shirt: "#ac7652", legs: "#9b674d", shoes: "#694839" },
  penguin: { shirt: "#384657", legs: "#344557", shoes: "#efad59" },
  shark: { shirt: "#708da7", legs: "#5c7896", shoes: "#57718b" },
  jellyfish: { shirt: "#b091d3", coversLegs: true },
  pirate: { shirt: "#894754", legs: "#4d3a43", shoes: "#302a34" },
  watermelon: { shirt: "#ed7278", legs: "#65a066", shoes: "#3f7954" },
  pumpkin: { shirt: "#dc863c", legs: "#996136", shoes: "#665237" },
  skeleton: { shirt: "#3a3445", legs: "#3a3445", shoes: "#3a3445" },
  reindeer: { shirt: "#a66d52", legs: "#966048", shoes: "#67443a" },
  chef: { shirt: "#f3e7d3", legs: "#6a686d", shoes: "#3d3842" },
  doctor: { shirt: "#edf1e9", legs: "#638b9a", shoes: "#506675" },
  astronaut: { shirt: "#eee5d2", legs: "#d5d5cc", shoes: "#939baa" },
  knight: { shirt: "#9ba7b5", legs: "#788597", shoes: "#566478" },
  detective: { shirt: "#bc9469", legs: "#62606b", shoes: "#5d493e" },
};
export function lockedAvatarOptions(top) {
  if (Object.hasOwn(costumes, top)) return ["clothes", "bottom", "bottomColor", "shoes", "accessory"];
  return Object.hasOwn(baseball, top) ? ["clothes"] : [];
}
const bottoms = {
  trousers: "긴바지", shorts: "반바지", jeans: "청바지", joggers: "츄리닝", skirt: "치마",
  overalls: "멜빵바지", pajamaPants: "잠옷 바지",
};
const accessoryNames = {
  none: "해제", glasses: "안경", beret: "베레모", ribbon: "리본", wings: "천사 날개",
  party: "고깔모자", sunglasses: "선글라스", mustache: "콧수염", scarf: "목도리", headphones: "헤드폰",
  roseBite: "장미", strawHat: "밀짚모자", crown: "왕관", flowerCrown: "화관",
  bunnyEars: "토끼 귀", catEars: "고양이 귀",
  mask: "마스크", bandage: "반창고", eyePatch: "안대",
  beanie: "비니", dogEars: "강아지 귀", devilHorns: "악마 뿔", halo: "천사 링", hairclips: "머리핀",
  backpack: "백팩", bundle: "보따리", devilWings: "악마 날개",
  bowTie: "나비넥타이", silkScarf: "스카프", necklace: "목걸이",
};
const expressions = {
  neutral: "기본", blush: "발그레", tongue: "메롱", angry: "화남", happy: "웃음",
  wink: "윙크", surprised: "깜짝", sleepy: "졸림", sad: "울먹", sparkle: "반짝",
  heartEyes: "하트 눈", sweat: "땀 삐질", dizzy: "어지러움", bored: "심드렁",
  pout: "시무룩", curious: "궁금", drool: "침 흘림",
};

export const avatarOptions = {
  hairstyle: { title: "머리 모양", items: hairstyles },
  hair: { title: "색깔", items: {
    default: "기본", ink: "먹색", chestnut: "밤색", honey: "꿀빛", plum: "자두",
    silver: "은색", coral: "코랄", copper: "구리", ocean: "바다", moss: "이끼",
    lavender: "라벤더", cream: "크림", pink: "분홍",
  } },
  skin: { title: "피부색", items: skinColors },
  top: {
    title: "상의",
    items: { ...tops, ...Object.fromEntries(Object.entries(baseball).map(([id, [name]]) => [id, name])) },
    sections: [
      ["일반 상의", Object.keys(tops).filter(id => !Object.hasOwn(costumes, id))],
      ["코스튬", Object.keys(costumes)],
      ["KBO 야구 유니폼", Object.keys(baseball)],
    ],
  },
  clothes: { title: "색깔", items: {
    default: "기본", mint: "민트", rose: "장미", sky: "하늘", lilac: "연보라",
    amber: "호박", ivory: "아이보리", navy: "남색", red: "빨강",
  } },
  bottom: { title: "하의", items: bottoms },
  bottomColor: { title: "색깔", items: {
    default: "기본", ...clothesColors, ink: "#292b36", plaid: "체크무늬", striped: "줄무늬",
  } },
  shoes: { title: "색깔", items: shoeColors },
  accessory: { title: "액세서리", items: accessoryNames, sections: [
    ["", ["none"]],
    ["얼굴", ["glasses", "sunglasses", "mustache", "roseBite", "mask", "bandage", "eyePatch"]],
    ["머리", ["beret", "ribbon", "party", "headphones", "strawHat", "crown", "flowerCrown", "bunnyEars", "catEars", "beanie", "dogEars", "devilHorns", "halo", "hairclips"]],
    ["목", ["scarf", "bowTie", "silkScarf", "necklace"]],
    ["등", ["wings", "backpack", "bundle", "devilWings"]],
  ] },
  expression: { title: "표정", items: expressions },
};

const defaults = {
  hairstyle: "short", hair: "default", skin: "sand", top: "tee", clothes: "default",
  bottom: "trousers", bottomColor: "default", shoes: "ink", accessory: "none", expression: "neutral",
};

const legacyOptions = {
  hairstyle: { curly: "ringlets" },
  top: { leatherJacket: "denimJacket" },
  bottom: { black: "trousers", denim: "shorts", stripedPants: "trousers", plaidSkirt: "skirt", stripedSkirt: "skirt" },
};
const legacyBottomColors = { black: "ink", denim: "sky", stripedPants: "striped" };
const legacySkirtPatterns = { plaidSkirt: "plaid", stripedSkirt: "striped" };

export function normalizeAppearance(value) {
  const appearance = {};
  for (const [name, fallback] of Object.entries(defaults)) {
    const original = value?.[name];
    const key = legacyOptions[name]?.[original] ?? original;
    appearance[name] = typeof key === "string" && Object.hasOwn(avatarOptions[name].items, key)
      ? key : fallback;
  }
  if (Object.hasOwn(legacySkirtPatterns, value?.bottom)) {
    appearance.bottomColor = legacySkirtPatterns[value.bottom];
  } else if (!value?.bottomColor && Object.hasOwn(legacyBottomColors, value?.bottom)) {
    appearance.bottomColor = legacyBottomColors[value.bottom];
  }
  if (appearance.bottom === "overalls" && !Object.hasOwn(costumes, appearance.top)) {
    appearance.top = defaults.top;
    appearance.clothes = defaults.clothes;
  }
  const shade = value?.skinShade;
  appearance.skinShade = (typeof shade === "number" || typeof shade === "string") &&
    Number.isFinite(Number(shade)) ? Math.round(Math.max(0, Math.min(100, Number(shade)))) : 50;
  return appearance;
}

export function skinTone(key, shade) {
  const rgb = skinColors[key].slice(1).match(/../g).map(part => Number.parseInt(part, 16));
  const amount = (shade - 50) / 50;
  const target = amount < 0 ? 0 : 255;
  const channels = rgb.map(channel => Math.round(channel + (target - channel) * Math.abs(amount) * 0.48));
  return "rgb(" + channels.join(",") + ")";
}

// Parts share a 28 × 30 pixel body grid. Negative coordinates extend hats and wings.
const backHair = {
  ponytail: [[19,1,6,5],[22,3,5,7],[23,7,5,7],[24,13,5,6],[24,19,4,2],[24,21,2,1]],
  twinBuns: [[3,-5,5,1],[1,-4,8,6],[3,2,6,2],[20,-5,5,1],[19,-4,8,6],[19,2,6,2]],
  bun: [[10,-7,8,1],[8,-6,12,4],[9,-2,10,3],[11,1,6,1]],
  longCurls: [[2,5,6,19],[20,5,6,19],[0,12,5,4],[23,12,5,4],[0,19,7,5],[21,19,7,5]],
  waves: [[3,5,5,10],[1,13,6,6],[3,18,5,4],[1,22,6,3],[20,5,5,10],[22,13,5,6],[20,18,5,4],[21,22,6,3]],
  fringeLong: [[2,5,6,19],[20,5,6,19],[1,20,6,5],[21,20,6,5]],
  long: [[3, 7, 5, 15], [20, 7, 5, 15], [2, 18, 5, 5], [21, 18, 5, 5]],
  bob: [[3, 7, 5, 9], [20, 7, 5, 9]],
  braids: [[3, 9, 4, 9], [2, 16, 5, 4], [3, 20, 3, 3], [21, 9, 4, 9], [21, 16, 5, 4], [22, 20, 3, 3]],
  pigtails: [[0, 3, 6, 9], [0, 10, 4, 6], [22, 3, 6, 9], [24, 10, 4, 6]],
};
const crowns = {
  bald: [],
  ponytail: [[7,0,14,3],[5,3,18,4],[5,7,3,3],[20,7,3,3]],
  twinBuns: [[8,-1,12,2],[6,1,16,3],[4,4,20,2],[5,6,4,3],[8,6,5,1],[18,6,5,2],[20,8,3,2]],
  bun: [[8,-1,12,2],[6,1,16,3],[5,4,18,2],[5,6,4,4],[8,6,5,1],[19,6,4,4]],
  ringlets: [[6,2,16,5],[6,0,5,7],[9,-2,5,6],[13,0,5,8],[17,-2,5,6],[20,2,5,7],[3,4,5,6],[8,4,3,6],[16,5,3,5]],
  afro: [
    [7,-7,5,4],[11,-9,7,6],[17,-8,5,6],[4,-5,5,6],[20,-6,5,6],[1,-2,6,7],[23,-3,5,7],
    [4,-3,20,8],[-1,2,7,7],[23,1,7,8],[1,7,7,5],[21,7,8,5],[2,11,5,3],[22,11,5,3],
    [6,2,16,4],[7,5,4,3],[11,4,5,3],[17,4,5,4],
  ],
  longCurls: [[6,-1,5,8],[10,-3,6,9],[15,-2,6,8],[19,0,5,8],[3,3,5,9],[21,3,5,9],[8,5,5,4]],
  waves: [[8,-2,13,3],[5,1,19,4],[4,4,15,2],[4,6,9,2],[4,8,5,4],[21,4,4,9],[20,11,4,5]],
  mohawk: [[13,-8,3,3],[11,-5,7,4],[10,-1,9,5],[12,4,5,3],[6,5,4,2],[19,5,3,2]],
  bowl: [[8,0,12,2],[5,2,18,3],[3,5,22,4],[4,9,4,2],[20,9,4,2]],
  antenna: [[9,1,1,2],[10,2,1,2],[11,3,1,2],[13,-1,1,2],[14,0,1,5],[18,1,1,2],[17,2,1,2],[16,3,1,2]],
  fringeLong: [[7,-2,14,3],[4,1,20,5],[3,5,5,11],[21,5,4,11]],
  fringeShort: [[7,-2,12,3],[4,1,19,5],[4,5,4,5],[21,5,3,6]],
  short: [[8, 0, 12, 2], [6, 2, 16, 2], [4, 4, 20, 2], [4, 6, 4, 5], [20, 6, 4, 5]],
  crop: [[8, 2, 12, 2], [6, 4, 16, 2], [5, 6, 18, 2]],
  spikes: [[5, 1, 18, 5], [7, -2, 3, 4], [13, -4, 3, 6], [19, -2, 3, 5], [5, 5, 5, 3], [18, 5, 5, 2]],
  side: [[7, 0, 15, 2], [5, 2, 19, 4], [5, 6, 8, 2], [5, 8, 4, 3], [21, 6, 3, 4]],
  bob: [[7, 0, 14, 3], [4, 3, 20, 3], [4, 6, 4, 8], [20, 6, 4, 8], [8, 6, 8, 2]],
  long: [[7, -1, 14, 3], [4, 2, 20, 4], [4, 6, 4, 10], [20, 6, 4, 10], [8, 6, 5, 2]],
  braids: [[8, 0, 12, 2], [5, 2, 18, 4], [5, 6, 5, 4], [18, 6, 5, 4]],
  pigtails: [[8, 0, 12, 2], [5, 2, 18, 4], [5, 6, 4, 3], [19, 6, 4, 3], [9, 6, 10, 2]],
};

const decorations = {
  none: [],
  mask: [[6,11,16,2,"#b6d7d5"],[8,11,12,4,"#d9efec"],[9,13,10,1,"#8ab5b7"]],
  bandage: [[16,11,6,3,"#f4b9a0"],[18,11,2,3,"#ffe2c5"],[17,12,1,1,"#cf8876"],[20,12,1,1,"#cf8876"]],
  eyePatch: [[7,10,5,5,"#40343f"],[9,9,6,1,"#40343f"],[15,8,5,1,"#40343f"],[20,7,2,1,"#40343f"]],
  beanie: [[7,-4,14,2,"#9f719c"],[5,-2,18,5,"#a87ba6"],[4,3,20,3,"#78577e"],[8,4,2,1,"#c499c0"],[18,4,2,1,"#c499c0"]],
  dogEars: [[3,0,5,4,"#9d6e55"],[20,0,5,4,"#9d6e55"],[1,3,5,8,"#774d43"],[22,3,5,8,"#774d43"],[2,5,2,4,"#b78168"],[24,5,2,4,"#b78168"]],
  devilHorns: [[5,-8,2,5,"#932e50"],[5,-4,5,4,"#c7485f"],[21,-8,2,5,"#932e50"],[18,-4,5,4,"#c7485f"]],
  halo: [[9,-10,10,2,"#ffe294"],[7,-8,2,2,"#e9af50"],[19,-8,2,2,"#e9af50"],[9,-6,10,1,"#e9af50"]],
  hairclips: [[17,4,6,2,"#f6b2c2"],[18,7,6,2,"#f1d995"],[21,4,1,2,"#fff1d1"],[22,7,1,2,"#fff1d1"]],
  backpack: [[19,14,7,11,"#9d6548"],[23,16,4,7,"#bf8a5e"],[22,20,5,2,"#dfac74"],[20,13,4,2,"#68483e"]],
  bundle: [[20,10,1,16,"#815735"],[21,10,7,7,"#b66368"],[22,8,5,10,"#d4807c"],[22,10,2,2,"#f3b89d"]],
  devilWings: [[-6,9,2,8,"#653955"],[-6,12,8,6,"#9f4a68"],[-3,16,10,5,"#783e60"],[-4,17,2,5,"#653955"],[32,9,2,8,"#653955"],[26,12,8,6,"#9f4a68"],[21,16,10,5,"#783e60"],[30,17,2,5,"#653955"]],
  bowTie: [[9,15,4,4,"#824969"],[15,15,4,4,"#824969"],[13,16,2,2,"#d17f96"]],
  silkScarf: [[8,15,12,2,"#729880"],[11,17,8,2,"#8db59c"],[15,18,3,4,"#6c9683"],[15,20,3,1,"#c9dbad"]],
  necklace: [[9,15,2,2,"#d4a04d"],[17,15,2,2,"#d4a04d"],[11,17,6,1,"#e5bb67"],[13,18,2,2,"#6d9d9b"]],
  glasses: [[6,8,7,5,"#393442"],[15,8,7,5,"#393442"],[13,9,2,1,"#393442"],[7,9,5,3,"#e4e3d0"],[16,9,5,3,"#e4e3d0"],[10,10,1,2,"#393442"],[16,10,1,2,"#393442"]],
  beret: [[6,0,16,5,"#994d60"],[8,-2,12,2,"#994d60"],[4,2,2,3,"#994d60"],[13,-3,2,1,"#c1737c"],[6,4,16,1,"#713d50"]],
  ribbon: [[17,1,3,5,"#ec9ea8"],[22,1,3,5,"#ec9ea8"],[20,2,2,3,"#f5c8b1"],[19,6,1,2,"#ce748b"],[22,6,1,2,"#ce748b"]],
  wings: [
    [-7,8,3,7,"#e7e1f5"], [-5,11,5,9,"#fffaf0"], [-3,15,7,7,"#fffaf0"],
    [-2,20,5,3,"#c9bddc"], [-6,16,4,2,"#d8cee9"], [-4,19,5,2,"#d8cee9"],
    [32,8,3,7,"#e7e1f5"], [28,11,5,9,"#fffaf0"], [24,15,7,7,"#fffaf0"],
    [25,20,5,3,"#c9bddc"], [30,16,4,2,"#d8cee9"], [27,19,5,2,"#d8cee9"],
  ],
  party: [[9,-2,10,5,"#a674cb"],[11,-6,6,5,"#b881d6"],[13,-9,2,4,"#d8a2ee"],[13,-10,2,2,"#f5c968"],[11,0,5,1,"#f6c975"]],
  sunglasses: [[5,8,18,2,"#323144"],[6,10,7,3,"#282638"],[15,10,7,3,"#282638"],[8,9,3,1,"#a6a0d2"],[17,9,3,1,"#a6a0d2"]],
  mustache: [[10,13,3,1,"#402f36"],[13,12,2,1,"#402f36"],[15,13,3,1,"#402f36"]],
  scarf: [[6,15,16,3,"#cb6676"],[16,18,4,5,"#ae4c60"],[16,21,4,1,"#ef9b99"],[8,16,10,1,"#ef9b99"]],
  headphones: [[7,-1,14,2,"#5a749a"],[4,1,3,7,"#5a749a"],[21,1,3,7,"#5a749a"],[3,7,5,6,"#889dc3"],[20,7,5,6,"#889dc3"]],
  roseBite: [
    [12,13,10,1,"#4e8b58"], [17,14,3,1,"#76ae66"],
    [21,11,4,3,"#ba345a"], [22,10,2,1,"#ef758b"], [22,12,2,1,"#ec7186"],
  ],
  strawHat: [
    [7,-4,14,5,"#dab276"], [9,-5,10,2,"#edc990"],
    [7,-1,14,2,"#a95d55"], [2,1,24,2,"#dcb16f"], [4,3,20,1,"#8b643f"],
  ],
  crown: [
    [6,-2,16,4,"#e3ab55"], [6,-5,3,4,"#f2cb73"], [12,-7,4,6,"#f2cb73"],
    [19,-5,3,4,"#f2cb73"], [7,1,14,1,"#ae763e"], [13,-2,2,2,"#ce5679"],
  ],
  flowerCrown: [
    [4,2,20,2,"#568467"], [5,1,4,3,"#e583a0"], [10,0,4,4,"#e5ae67"],
    [15,1,4,3,"#c19be5"], [20,0,4,4,"#e287aa"], [11,1,2,1,"#fff0b8"],
  ],
  bunnyEars: [
    [7,-9,5,11,"#ede2df"], [16,-9,5,11,"#ede2df"],
    [8,-7,3,7,"#dc91a9"], [17,-7,3,7,"#dc91a9"],
  ],
  catEars: [
    [5,-7,1,1,"#68556c"], [4,-6,3,2,"#68556c"], [4,-4,5,2,"#68556c"],
    [3,-2,8,3,"#68556c"], [5,-4,1,2,"#db8eac"], [5,-2,3,2,"#db8eac"],
    [22,-7,1,1,"#68556c"], [21,-6,3,2,"#68556c"], [19,-4,5,2,"#68556c"],
    [17,-2,8,3,"#68556c"], [22,-4,1,2,"#db8eac"], [20,-2,3,2,"#db8eac"],
  ],
};

const costumeDetails = {
  frog: { back: [[-2,13,7,11,"#4d854f"],[0,10,9,14,"#6ca45a"],[3,11,5,3,"#a2c777"],[0,17,6,2,"#a2c777"],[1,20,3,1,"#a2c777"]] },
  witch: { back: [[27,1,2,28,"#875436"],[25,-4,6,7,"#946851"],[26,-3,4,4,"#cb94c8"],[27,-3,2,2,"#f4c9ed"]] },
  vampire: { face: [[11,12,6,2,"#542a3c"],[11,12,1,3,"#fff4e1"],[16,12,1,3,"#fff4e1"]] },
  snowWhite: { body: [[21,20,5,4,"#b93e4a"],[22,19,3,6,"#cf5154"],[23,18,1,2,"#517951"],[22,21,1,1,"#ffac97"]] },
  bear: {
    head: [[3,-2,6,6,"#9c684b"],[19,-2,6,6,"#9c684b"],[6,-1,16,6,"#b47d57"],[4,4,4,8,"#b47d57"],[20,4,4,8,"#b47d57"],[10,11,8,4,"#d9b08a"],[13,11,2,1,"#674238"]],
    body: [[9,17,10,6,"#ddaf84"]],
  },
  penguin: {
    head: [[6,-2,16,6,"#394659"],[4,3,5,10,"#394659"],[19,3,5,10,"#394659"],[12,11,4,3,"#e9a655"]],
    body: [[8,16,12,8,"#f5eadc"],[3,16,5,7,"#384657"],[20,16,5,7,"#384657"]],
  },
  shark: {
    head: [[14,-8,2,4,"#54748e"],[12,-5,5,5,"#708da7"],[5,-1,18,6,"#708da7"],[4,4,4,10,"#708da7"],[20,4,4,10,"#708da7"],[8,5,2,2,"#f8eee0"],[13,5,2,2,"#f8eee0"],[18,5,2,2,"#f8eee0"]],
    back: [[22,21,7,4,"#708da7"],[27,18,2,4,"#54748e"]],
    body: [[9,16,10,8,"#e3e6dc"]],
  },
  jellyfish: {
    head: [[8,-5,12,2,"#dcbeeb"],[4,-3,20,5,"#b091d3"],[1,2,26,4,"#b091d3"],[2,6,24,2,"#d5b6e7"],[4,8,2,9,"#c0a2de"],[22,8,2,9,"#c0a2de"]],
    body: [[5,18,18,6,"#b091d3"],[4,24,3,5,"#d5b6e7"],[9,23,3,7,"#aa86d0"],[15,23,3,6,"#d5b6e7"],[21,23,3,7,"#aa86d0"]],
  },
  pirate: {
    head: [[3,-3,22,5,"#433541"],[7,-6,14,5,"#433541"],[11,-4,6,3,"#f1e4cc"],[3,2,22,2,"#b85e62"]],
    face: [[7,9,6,4,"#40343f"],[13,9,4,1,"#40343f"],[17,8,5,1,"#40343f"]],
    body: [[7,19,14,2,"#dca46a"],[13,19,3,2,"#f5cd85"],[11,16,6,2,"#ebe1c6"]],
  },
  watermelon: {
    head: [[5,0,18,4,"#65a066"],[8,-2,12,2,"#3f7954"],[5,4,18,1,"#b5c47d"]],
    body: [[5,17,18,7,"#ed7278"],[7,24,14,2,"#b5c47d"],[9,26,10,1,"#65a066"],[9,18,1,2,"#513542"],[17,18,1,2,"#513542"],[13,21,1,2,"#513542"]],
  },
  pumpkin: {
    head: [[6,0,16,4,"#dc863c"],[10,-2,8,3,"#efaa54"],[13,-4,3,3,"#698459"]],
    body: [[6,16,16,2,"#dc863c"],[4,18,20,6,"#dc863c"],[7,24,14,3,"#dc863c"],[8,18,1,6,"#eeaa57"],[19,18,1,6,"#eeaa57"],[10,19,2,2,"#673f35"],[16,19,2,2,"#673f35"],[12,22,4,1,"#673f35"]],
  },
  skeleton: {
    head: [[7,-2,14,4,"#e8e0d6"],[5,2,18,11,"#e8e0d6"],[8,13,12,3,"#e8e0d6"],[8,8,5,4,"#423744"],[15,8,5,4,"#423744"],[11,14,1,2,"#6b5b67"],[15,14,1,2,"#6b5b67"]],
    body: [[13,16,2,8,"#e8e0d6"],[9,17,10,1,"#e8e0d6"],[9,19,10,1,"#e8e0d6"],[10,21,8,1,"#e8e0d6"],[9,25,2,3,"#e8e0d6"],[17,25,2,3,"#e8e0d6"]],
  },
  reindeer: {
    head: [[4,-7,2,7,"#724b3d"],[2,-6,2,2,"#724b3d"],[22,-7,2,7,"#724b3d"],[24,-6,2,2,"#724b3d"],[2,1,5,4,"#af7859"],[21,1,5,4,"#af7859"],[6,0,16,5,"#a66d52"]],
    face: [[12,11,4,3,"#dc505a"],[12,11,2,1,"#ff9b93"]],
    body: [[9,16,10,7,"#d8ad7e"],[8,15,12,2,"#547957"],[13,17,2,2,"#eec578"]],
  },
  chef: {
    head: [[4,-5,7,6,"#fbf0dd"],[9,-8,10,9,"#fbf0dd"],[17,-5,7,6,"#fbf0dd"],[6,1,16,3,"#e2d3ba"]],
    body: [[9,16,10,8,"#fbf0dd"],[10,17,2,3,"#ad5964"],[16,17,2,3,"#ad5964"],[13,20,2,2,"#ad5964"]],
  },
  doctor: {
    body: [[7,16,14,11,"#edf1e9"],[11,16,6,9,"#88b2ae"],[10,17,1,5,"#53676f"],[17,17,1,4,"#53676f"],[14,21,4,2,"#53676f"],[17,19,3,2,"#c66570"]],
  },
  astronaut: {
    head: [[7,-4,14,3,"#eee5d2"],[4,-1,20,5,"#eee5d2"],[2,4,5,10,"#d7d9d7"],[21,4,5,10,"#d7d9d7"],[5,12,18,4,"#c3c9c8"],[6,4,4,1,"#a2c6d0"]],
    body: [[8,16,12,2,"#a6908d"],[10,18,8,5,"#a8b5be"],[11,19,2,2,"#d6766a"],[15,19,2,2,"#e4cb86"],[8,25,4,1,"#a8b5be"],[16,25,4,1,"#a8b5be"]],
  },
  knight: {
    head: [[8,-4,12,3,"#b9c0cb"],[5,-1,18,5,"#9ba7b5"],[4,4,20,4,"#79879b"],[5,12,18,3,"#9ba7b5"],
      [8,15,12,2,"#79879b"],[7,17,14,1,"#a8b4c1"],[10,15,8,1,"#bec8d1"]],
    body: [[4,16,6,5,"#bec8d1"],[18,16,6,5,"#bec8d1"],[10,17,8,7,"#c0c8d2"],[12,19,4,3,"#8492a4"],[20,19,6,7,"#77879a"],[21,20,4,4,"#b9c6d1"]],
  },
  detective: {
    head: [[7,-4,14,6,"#a47b58"],[5,-1,18,2,"#704e44"],[2,2,24,3,"#bc9469"]],
    body: [[7,16,14,11,"#bc9469"],[9,16,3,4,"#ddba8d"],[16,16,3,4,"#ddba8d"],[7,22,14,2,"#9a7153"],[13,22,2,2,"#e4bc7d"],[22,19,2,5,"#634d46"],[21,15,6,5,"#634d46"],[22,16,4,3,"#b2d0cb"]],
  },
  hanbok: {
    body: [
      [6,16,3,5,"#f1d4c0"], [19,16,3,5,"#f1d4c0"], [8,22,12,2,"#bb596f"],
      [9,16,4,1,"#fff2df"], [11,17,4,1,"#fff2df"], [14,18,4,1,"#fff2df"],
      [13,19,5,1,"#9d3d5d"], [14,20,1,3,"#9d3d5d"], [17,20,1,2,"#9d3d5d"],
    ],
    head: [[19,1,3,2,"#d9905d"], [22,0,2,1,"#f2cb86"]],
  },
  santa: {
    body: [
      [4,17,4,5,"#bc3f50"], [20,17,4,5,"#bc3f50"], [4,21,4,1,"#f6e9da"],
      [20,21,4,1,"#f6e9da"], [13,16,2,7,"#f6e9da"], [8,22,12,2,"#39303a"],
      [13,22,2,2,"#ecc477"],
    ],
    head: [
      [7,-5,13,6,"#ba3f50"], [10,-8,9,3,"#ba3f50"], [16,-7,7,3,"#ba3f50"],
      [22,-6,4,4,"#f9ecdf"], [5,0,17,3,"#f9ecdf"],
    ],
  },
  school: {
    body: [
      [5,17,4,5,"#3b5275"], [19,17,4,5,"#3b5275"], [9,16,10,2,"#f0e8d9"],
      [11,18,6,1,"#f0e8d9"], [12,18,4,2,"#a64566"], [13,20,2,2,"#a64566"],
      [8,22,12,2,"#68758e"], [17,19,2,1,"#d0ad73"],
    ],
  },
  ghost: {
    body: [
      [5,14,18,11,"#e8e4f7"], [3,19,22,7,"#e8e4f7"],
      [4,26,6,3,"#e8e4f7"], [12,26,5,3,"#e8e4f7"], [19,26,5,2,"#e8e4f7"],
      [4,25,20,1,"#c9c0e6"],
    ],
    head: [
      [8,-2,12,3,"#e8e4f7"], [5,1,18,4,"#e8e4f7"], [4,5,20,9,"#e8e4f7"],
      [7,12,14,3,"#e8e4f7"], [9,8,2,1,"#f9f6ff"],
    ],
  },
  mermaid: {
    body: [
      [8,16,12,5,"#976db9"], [9,17,4,2,"#d4a4d6"], [15,17,4,2,"#d4a4d6"],
      [9,21,10,4,"#559e94"], [10,24,9,3,"#559e94"], [11,27,11,3,"#70bea9"],
      [18,26,7,2,"#70bea9"], [20,25,5,1,"#93d6bb"], [11,23,5,1,"#91d0bd"],
    ],
    head: [[20,1,4,3,"#d697c3"], [21,0,2,5,"#eec3df"], [21,2,2,1,"#f5df9c"]],
  },
  strawberry: {
    body: [
      [5,16,18,7,"#d65168"], [7,23,14,2,"#d65168"], [9,25,10,2,"#c4425b"],
      [8,18,1,1,"#f8d29d"], [12,21,1,1,"#f8d29d"], [16,18,1,1,"#f8d29d"],
      [19,21,1,1,"#f8d29d"], [15,24,1,1,"#f8d29d"],
    ],
    head: [
      [5,1,18,4,"#d65168"], [4,4,3,6,"#d65168"], [21,4,3,6,"#d65168"],
      [10,-1,8,3,"#64a06d"], [8,0,4,2,"#64a06d"], [16,0,4,2,"#64a06d"],
      [13,-3,2,3,"#78b77b"],
    ],
  },
  octopus: {
    body: [
      [6,16,16,8,"#bd76a7"], [3,21,4,5,"#bd76a7"], [21,21,4,5,"#bd76a7"],
      [2,25,6,2,"#c988b4"], [7,24,4,5,"#c988b4"], [12,24,4,6,"#bd76a7"],
      [17,24,4,5,"#c988b4"], [20,25,6,2,"#c988b4"],
      [5,25,1,1,"#eed0df"], [9,27,1,1,"#eed0df"], [18,27,1,1,"#eed0df"], [22,25,1,1,"#eed0df"],
    ],
    head: [
      [8,-2,12,3,"#bd76a7"], [5,1,18,4,"#bd76a7"],
      [4,4,3,7,"#bd76a7"], [21,4,3,7,"#bd76a7"], [9,0,4,1,"#e0a5c7"],
    ],
  },
};

// Offsets for hats and headbands that sit on the scalp. Face coverings stay aligned to the face.
const shortHairCostumeOffsets = {
  frog: 2, witch: 2, snowWhite: 2, santa: 2, detective: 1, chef: 2,
  pirate: 1, watermelon: 1, reindeer: 1,
};
const shortHairAccessoryOffsets = {
  beret: 1, ribbon: 2, party: 1, strawHat: 1, crown: 3, flowerCrown: 2,
  bunnyEars: 3, catEars: 3, beanie: 1, dogEars: 1, devilHorns: 3, hairclips: 1,
};
const costumeHeadCoverings = new Set([
  "frog", "witch", "santa", "ghost", "bear", "penguin", "shark", "jellyfish",
  "pirate", "watermelon", "pumpkin", "skeleton", "reindeer", "chef",
  "astronaut", "knight", "detective", "strawberry", "octopus",
]);
const accessoryHeadCoverings = new Set(["beret", "party", "strawHat", "beanie"]);

const tiedHairShadows = {
  ponytail: [[20,2,5,3],[23,5,3,3],[24,8,2,3],[25,11,2,2]],
  twinBuns: [[6,-3,3,4],[5,1,4,2],[19,-3,3,4],[19,1,4,2]],
  bun: [[9,-3,11,1],[9,-2,10,2],[11,0,7,1]],
};
export const colorableBottoms = new Set(["trousers", "shorts", "skirt"]);
export const bottomPatterns = {
  plaid: "repeating-linear-gradient(0deg, transparent 0 4px, #f8e4ce80 4px 6px), repeating-linear-gradient(90deg, #78596a 0 4px, #b88797 4px 6px)",
  striped: "repeating-linear-gradient(90deg, #566479 0 4px, #dccab9 4px 6px)",
};
const overallsBib = [[9,16,2,5],[17,16,2,5],[8,21,12,3]];
const overallsButtons = [[9,20,2,1],[17,20,2,1]];
const backAccessories = new Set(["wings", "backpack", "bundle", "devilWings", "tail"]);
const bottomDefaults = {
  overalls: "#557ca5", pajamaPants: "#9a8abb",
};
const topDetails = {
  longSleeve: [[8,23,12,1,"#292c4940"],[10,16,8,1,"#fff2dd68"]],
  stripedTee: [[6,17,16,1,"#fff2ddaa"],[8,20,12,1,"#fff2ddaa"],[8,23,12,1,"#fff2ddaa"]],
  cardigan: [[11,16,6,2,"#efe2d2"],[13,18,2,6,"#32293b58"],[14,19,1,1,"#f2cd84"],[14,22,1,1,"#f2cd84"]],
  puffer: [[4,18,20,1,"#2b314751"],[4,21,20,1,"#2b314751"],[13,16,2,8,"#dce2e785"]],
  coat: [[9,15,3,4,"#35293560"],[16,15,3,4,"#35293560"],[12,17,2,9,"#35293560"],[15,21,1,1,"#f2cf91"],[17,22,2,1,"#35293560"]],
  denimJacket: [[9,16,10,1,"#d0d9de"],[13,17,2,7,"#304761"],[9,19,3,2,"#b1c6d6"],[16,19,3,2,"#b1c6d6"],[8,23,12,1,"#34485d"]],
  dress: [[12,17,4,2,"#fff1d9"],[8,21,12,1,"#fff1d988"],[7,25,14,1,"#fff1d9"]],
  varsity: [[4,17,4,5,"#ebe0d1"],[20,17,4,5,"#ebe0d1"],[13,16,2,8,"#f6e5ce"],[16,18,3,2,"#e8b775"]],
};
const outfitColors = { cardigan: "#b98285", puffer: "#849c9b", coat: "#a97850",
  denimJacket: "#597fa2", dress: "#cc849b", varsity: "#6b876c", vest: "#9a829e", knit: "#d8c6a8", hoodie: "#dadce3", pajamas: "#919dbb" };
const longSleeves = new Set(["tie", "shirt", "knit", "pajamas", "hoodie", "longSleeve", "cardigan", "puffer", "coat", "denimJacket", "varsity", "chef", "doctor", "astronaut", "knight", "detective"]);
const expressionsEyes = {
  heartEyes: [], dizzy: [], bored: [[9,10,4,1],[15,10,4,1],[12,13,4,1]],
  pout: [[10,10,2,2],[16,10,2,2],[12,13,1,1],[13,12,3,1],[16,13,1,1]],
  drool: [[9,10,4,1],[15,10,4,1],[12,12,4,2]],
  happy: [[9,10,1,2],[10,9,2,1],[12,10,1,2],[15,10,1,2],[16,9,2,1],[18,10,1,2]],
  wink: [[9,10,4,1],[16,10,2,2],[13,13,3,1]],
  surprised: [[10,9,2,3],[16,9,2,3],[13,12,2,2]],
  sleepy: [[9,11,4,1],[15,11,4,1],[13,13,2,1]],
  sad: [[10,10,2,2],[16,10,2,2],[10,9,2,1],[16,9,2,1],[12,13,4,1]],
  sparkle: [[9,9,4,3],[15,9,4,3],[13,13,2,1]],
};

export function drawAvatar(ctx, x, y, slot, appearance, { scale = 1, step = 0 } = {}) {
  const { hair, hairstyle, skin, skinShade, clothes, top, bottom, bottomColor, shoes, expression, accessory } = appearance;
  const hairColor = hairColors[hair] ?? defaultHair[slot % defaultHair.length];
  const skinColor = skinTone(skin, skinShade);
  const costume = costumes[top];
  const team = baseball[top];
  const shirtColor = costume?.shirt ?? team?.[1] ??
    (clothes === "default" ? outfitColors[top] ?? defaultClothes[slot % defaultClothes.length] : clothesColors[clothes]);
  const visibleAccessory = costume ? "none" : accessory;
  const pixel = (left, upper, width, height, color) => {
    // Snap shared edges so adjacent rectangles meet even at fractional scales.
    const startX = Math.round(x + left * scale);
    const startY = Math.round(y + upper * scale);
    const endX = Math.round(x + (left + width) * scale);
    const endY = Math.round(y + (upper + height) * scale);
    ctx.fillStyle = color;
    ctx.fillRect(startX, startY, endX - startX, endY - startY);
  };
  const layer = (boxes, color, offsetY = 0) => {
    for (const [left, upper, width, height, tint = color] of boxes) pixel(left, upper + offsetY, width, height, tint);
  };
  const exposedScalp = hairstyle === "bald" || hairstyle === "antenna";
  const costumeHeadOffset = exposedScalp ? shortHairCostumeOffsets[top] ?? 0 : 0;
  const accessoryHeadOffset = exposedScalp ? shortHairAccessoryOffsets[visibleAccessory] ?? 0 : 0;
  const hidesTuft = costumeHeadCoverings.has(top) || top === "hoodie" || accessoryHeadCoverings.has(visibleAccessory);
  if (backAccessories.has(visibleAccessory)) layer(decorations[visibleAccessory]);
  layer(costumeDetails[top]?.back ?? []);
  if (top === "vampire") layer([[5,14,18,2],[2,17,24,11],[1,25,26,3]], "#702f47");
  const hairShade = "#1d11294d";
  if (top !== "ghost") {
    const back = backHair[hairstyle] ?? [];
    layer(back, hairColor);
    const shadow = tiedHairShadows[hairstyle];
    if (shadow) {
      const channels = hairColor.slice(1).match(/../g).map(channel =>
        Math.round(Number.parseInt(channel, 16) * 0.83));
      layer(shadow, "rgb(" + channels.join(",") + ")");
    }
  }

  const visibleBottom = costume ? costume.bottom ?? (top === "snowWhite" ? "skirt" : "trousers") : bottom;
  const bottomStyle = !costume && colorableBottoms.has(visibleBottom) ? bottomColor : "default";
  const pattern = Object.hasOwn(bottomPatterns, bottomStyle) ? bottomStyle : null;
  const customLegColor = bottomStyle !== "default" && !pattern ? avatarOptions.bottomColor.items[bottomStyle] : undefined;
  const pajamaColor = top === "pajamas" && bottom === "pajamaPants" ? shirtColor : undefined;
  const legColor = costume?.legs ?? pajamaColor ?? customLegColor ?? legColors[visibleBottom] ?? bottomDefaults[visibleBottom];
  const legY = Math.round(step / scale);
  const short = visibleBottom === "shorts";
  const skirt = visibleBottom === "skirt";
  if (!costume?.coversLegs) {
    layer([[8,24 + legY,12,short ? 1 : 2],[8,25 + legY,4,3],[16,25 + legY,4,3]], legColor);
    if (short || skirt) {
      layer([[8,27 + legY,4,1],[16,27 + legY,4,1]], skinColor);
    }
    if (visibleBottom === "jeans") pixel(8,24 + legY,1,2,"#a5bdd0");
    if (visibleBottom === "joggers") layer([[8,24 + legY,1,4],[19,24 + legY,1,4]], "#d2cbdb");
    if (skirt) {
      layer([[8,22,12,2],[6,24,16,3]], legColor);
      layer([[9,24,1,3],[17,24,1,3]], costume ? "#f7d789" : "#cc96af");
    }
    if (pattern && visibleBottom === "skirt") {
      layer([[8,24,1,3],[12,22,1,5],[16,22,1,5],[20,24,1,3]], "#f9e6d69e");
      if (pattern === "plaid") layer([[8,22,12,1],[6,24,16,1],[6,26,16,1]], "#f9e6d68e");
    } else if (pattern) {
      const height = short ? 3 : 4;
      layer([[9,24 + legY,1,height],[11,24 + legY,1,height],[16,24 + legY,1,height],[18,24 + legY,1,height]], "#f9e6d69e");
      if (pattern === "plaid") layer([[8,24 + legY,12,1],[8,26 + legY,4,1],[16,26 + legY,4,1]], "#f9e6d68e");
    }
    if (visibleBottom === "pajamaPants") layer([[9,25 + legY,1,1],[11,27 + legY,1,1],[17,25 + legY,1,1],[19,27 + legY,1,1]], "#f5e6c7");
    layer([[6,28 + legY,6,2],[16,28 + legY,6,2]], costume?.shoes ?? shoeColors[shoes]);
  }

  layer([[6,6,16,8],[8,14,12,2],[4,18,4,4],[20,18,4,4]], skinColor);
  layer([[8,16,12,8]], shirtColor);
  if (top === "dress") layer([[8,23,12,2],[6,25,16,2]], shirtColor);
  if (top === "coat") layer([[7,22,14,4]], shirtColor);
  if (top === "vest") {
    layer([[5,16,4,4],[19,16,4,4],[8,16,12,8]], "#fffaf2");
    layer([[8,16,3,1],[17,16,3,1],[7,17,5,3],[16,17,5,3],
      [7,20,6,3],[15,20,6,3],[7,23,5,1],[16,23,5,1],[7,24,3,1],[18,24,3,1]], shirtColor);
    layer([[11,18,1,2],[16,18,1,2],[12,21,1,2],[15,21,1,2]], "#32293b50");
  }
  if (top !== "tank" && top !== "vest") layer([[6,16,2,4],[20,16,2,4]], shirtColor);
  if (longSleeves.has(top)) {
    layer([[4,17,5,6],[19,17,5,6]], shirtColor);
    layer([[4,22,4,1],[20,22,4,1]], "#2e293852");
    layer([[5,23,3,1],[20,23,3,1]], skinColor);
  }
  if (top === "tie" || top === "shirt") layer([[9,16,4,2,"#e5e1d5"],[15,16,4,2,"#e5e1d5"],[13,18,2,5,top === "tie" ? "#9a424e" : "#dbd2c3"]]);
  if (top === "tank") {
    layer([[6,17,2,3],[20,17,2,3],[7,16,3,2],[18,16,3,2],[10,16,8,1]], skinColor);
    layer([[8,16,2,2],[18,16,2,2],[10,17,8,1]], shirtColor);
  }
  if (top === "knit") {
    layer([[8,23,12,1],[9,16,10,1],[4,22,4,1],[20,22,4,1]], "#64504068");
    layer([[9,19,1,2],[10,18,1,1],[10,21,1,1],[11,19,1,2],
      [16,19,1,2],[17,18,1,1],[17,21,1,1],[18,19,1,2],
      [13,17,1,6],[8,23,1,1],[11,23,1,1],[15,23,1,1],[18,23,1,1]], "#fff3dbbd");
  }
  if (top === "uniform") layer([[6,17,2,2],[20,17,2,2],[12,18,4,1],[14,19,2,3]], "#f2e8cd");
  if (top === "pajamas") {
    layer([[9,16,3,1],[16,16,3,1],[11,17,2,1],[15,17,2,1],[13,18,1,6],[4,22,4,1],[20,22,4,1]], "#f2deba");
    layer([[16,19,3,2],[9,20,1,1],[14,19,1,1],[14,21,1,1]], "#fff3d8");
  }
  if (top === "hoodie") {
    layer([[9,23,10,1],[11,21,6,1],[10,22,1,1],[17,22,1,1]], "#27263355");
    layer([[11,16,1,4],[16,16,1,4]], "#3d3946");
  }
  layer(topDetails[top] ?? []);
  if (!costume && top !== "dress" && bottom === "overalls") {
    layer(overallsBib, bottomDefaults.overalls);
    layer(overallsButtons, "#efce89");
  }
  if (top === "varsity") {
    ctx.save();
    ctx.fillStyle = "#382937";
    ctx.font = "bold " + (4 * scale) + "px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("SSU", x + 16 * scale, y + 21 * scale, 4 * scale);
    ctx.restore();
  }
  if (team) {
    const [, , trim, badge, striped] = team;
    if (striped) layer([[9,16,1,8],[12,16,1,8],[16,16,1,8],[19,16,1,8]], "#432f4938");
    layer([[6,17,2,2],[20,17,2,2],[13,16,2,8],[9,16,4,1],[15,16,4,1]], trim);
    layer([[10,18,2,2],[16,18,3,1],[17,19,2,1]], badge);
  }
  if (top === "frog") layer([[9,17,10,6]], "#9dc17a");
  if (top === "witch") layer([[6,17,3,4],[19,17,3,4],[8,21,12,2],[12,20,4,3]], "#ae7955");
  if (top === "vampire") layer([[6,15,4,3,"#a74056"],[18,15,4,3,"#a74056"],[11,16,6,5,"#efe2d3"],[11,17,6,1,"#962b47"],[13,19,2,2,"#962b47"]]);
  if (top === "snowWhite") layer([[5,16,4,4,"#6e9ad0"],[19,16,4,4,"#6e9ad0"],[6,17,2,2,"#c85166"],[20,17,2,2,"#c85166"],[9,16,10,1,"#f5ebd4"],[8,22,12,2,"#e5b44f"]]);
  layer(costumeDetails[top]?.body ?? []);

  if (top !== "ghost") {
    if (exposedScalp) layer([[8,4,12,2],[7,5,14,1]], skinColor);
    if (hairstyle !== "antenna" || !hidesTuft) layer(crowns[hairstyle], hairColor);
  }
  if (top === "frog") layer([[5,-2,18,5,"#6caa64"],[6,-4,5,4,"#93c979"],[17,-4,5,4,"#93c979"],[8,-3,1,1,"#283833"],[19,-3,1,1,"#283833"]], undefined, costumeHeadOffset);
  if (top !== "ghost" && hairstyle === "ponytail") layer([[22,4,3,3]], "#e5a5af");
  if (top !== "ghost" && hairstyle === "bun") layer([[11,-1,7,1],[12,0,5,1]], "#e5a5af");
  if (top !== "ghost" && hairstyle === "twinBuns") layer([[6,0,2,2],[20,0,2,2]], "#e5a5af");
  if (top !== "ghost" && hairstyle === "afro") {
    layer([[9,-6,2,1],[13,-7,3,1],[19,-5,2,1],[5,-3,2,1],[2,3,2,2],[6,0,2,2],
      [11,-2,2,1],[15,0,2,2],[20,-1,2,2],[25,3,2,1],[3,8,2,1],[24,8,2,1]], "#fff5ef4d");
    layer([[9,-3,2,1],[16,-4,2,1],[2,5,2,1],[21,2,2,1],[13,3,2,1],[23,10,2,1]], hairShade);
  }
  if (top !== "ghost" && hairstyle === "braids") layer([[3,16,3,1],[22,16,3,1]], "#de939e");
  if (top !== "ghost" && hairstyle === "pigtails") layer([[4,4,2,4],[22,4,2,4]], "#de939e");
  if (top === "hoodie") {
    layer([[8,-2,12,2],[5,0,4,3],[19,0,4,3],[3,3,4,9],[21,3,4,9],
      [5,12,4,3],[19,12,4,3],[8,14,5,2],[15,14,5,2]], shirtColor);
    layer([[7,1,2,2],[5,3,2,9],[21,3,2,9],[7,12,2,2],[19,12,2,2]], "#3d354a60");
  }
  if (top === "witch") layer([[2,0,24,3,"#332641"],[7,-3,14,3,"#765482"],[9,-6,9,3,"#45324f"],[11,-9,5,3,"#45324f"],[13,-11,3,2,"#45324f"],[13,-2,3,2,"#e4b775"]], undefined, costumeHeadOffset);
  if (top === "snowWhite") layer([[6,2,16,1,"#a43c58"],[14,-2,3,4,"#ca536a"],[19,-2,3,4,"#ca536a"],[17,-1,2,2,"#e9878f"]], undefined, costumeHeadOffset);
  layer(costumeDetails[top]?.head ?? [], undefined, costumeHeadOffset);
  layer(expressionsEyes[expression] ?? [[10,10,2,2],[16,10,2,2]], "#242b2d");
  if (expression === "blush") layer([[7,12,3,1],[18,12,3,1],[13,13,2,1]], "#d47885");
  if (expression === "tongue") layer([[12,12,4,2,"#55323d"],[13,13,3,2,"#ea8195"]]);
  if (expression === "angry") {
    layer([[9,8,2,1],[11,9,2,1],[15,9,2,1],[17,8,2,1],[12,13,4,1]], "#47323a");
  }
  if (expression === "sad") layer([[10,12,1,2],[17,12,1,2]], "#79c4f1");
  if (expression === "sparkle") layer([[10,9,1,2],[9,10,3,1],[16,9,1,2],[15,10,3,1]], "#fff5b8");
  if (expression === "heartEyes") {
    for (const eye of [8, 15]) layer([[eye,9,2,2],[eye + 3,9,2,2],[eye + 1,10,3,2],[eye + 2,12,1,1]], "#d44e71");
  }
  if (expression === "dizzy") {
    for (const eye of [8, 15]) layer([[eye,8,5,1],[eye,9,1,4],[eye + 4,9,1,3],[eye + 2,10,2,1],[eye + 1,12,4,1]], "#48354e");
  }
  if (expression === "sweat") layer([[22,6,1,2],[21,8,3,3],[22,8,1,1,"#d6f3f5"]], "#74bad2");
  if (expression === "curious") layer([[24,-7,4,1],[27,-6,1,2],[25,-4,2,1],[25,-3,1,1],[25,-1,1,1]], "#987a40");
  if (expression === "sleepy") layer([[14,11,2,1,"#82b8da"],[16,10,3,4,"#83bddb"],[15,11,5,2,"#a7d9ee"],[17,11,2,1,"#e9f8fb"]]);
  if (expression === "drool") layer([[15,13,1,3],[15,15,2,1]], "#80c7df");
  if (top !== "ghost" && (hairstyle === "fringeLong" || hairstyle === "fringeShort")) {
    layer([[11,5,12,2],[13,7,10,2],[15,9,8,2],[17,11,5,2],[18,13,3,1]], hairColor);
  }
  layer(costumeDetails[top]?.face ?? []);
  if (!backAccessories.has(visibleAccessory)) layer(decorations[visibleAccessory], undefined, accessoryHeadOffset);
  if (expression === "angry") {
    layer([[23,-5,1,2],[21,-3,2,1],[26,-4,1,2],[27,-2,2,1],
      [22,0,2,1],[24,1,1,2],[27,0,2,1],[26,1,1,2]], "#f66e73");
  }
}

export function drawAvatarOption(ctx, category, value, slot, draft) {
  ctx.clearRect(0, 0, 40, 40);
  const base = normalizeAppearance({ hair: draft.hair, skin: draft.skin, skinShade: draft.skinShade, clothes: draft.clothes });
  const appearance = { ...base, [category]: value };
  if (category === "accessory") {
    const parts = decorations[value];
    const left = Math.min(...parts.map(part => part[0]));
    const top = Math.min(...parts.map(part => part[1]));
    const width = Math.max(...parts.map(part => part[0] + part[2])) - left;
    const height = Math.max(...parts.map(part => part[1] + part[3])) - top;
    const scale = Math.min(2, 34 / Math.max(width, height));
    for (const [x, y, w, h, color] of parts) {
      ctx.fillStyle = color;
      ctx.fillRect((40 - width * scale) / 2 + (x - left) * scale, (40 - height * scale) / 2 + (y - top) * scale, w * scale, h * scale);
    }
    return;
  }
  if (category === "bottom" && value === "overalls") {
    ctx.fillStyle = bottomDefaults.overalls;
    for (const [x, y, w, h] of [...overallsBib, [8,24,4,4], [16,24,4,4]]) {
      ctx.fillRect(12 + (x - 8) * 1.35, 12 + (y - 16) * 1.35, w * 1.35, h * 1.35);
    }
    ctx.fillStyle = "#efce89";
    for (const [x, y, w, h] of overallsButtons) {
      ctx.fillRect(12 + (x - 8) * 1.35, 12 + (y - 16) * 1.35, w * 1.35, h * 1.35);
    }
    return;
  }
  ctx.save();
  const upper = category === "top" || category === "clothes";
  const lower = category === "bottom";
  if (upper && !Object.hasOwn(costumes, value) && value !== "hoodie") {
    ctx.beginPath();
    ctx.rect(0, 11, 40, 19);
    ctx.clip();
    drawAvatar(ctx, 6, -5, slot, appearance);
  } else if (lower) {
    ctx.beginPath();
    ctx.rect(0, 11, 40, 15);
    ctx.clip();
    drawAvatar(ctx, 6, -11, slot, appearance);
  } else {
    const fullOutfit = Object.hasOwn(costumes, value);
    drawAvatar(ctx, fullOutfit ? 8 : 6, 10, slot, appearance, {
      scale: fullOutfit ? 0.85 : 1,
    });
  }
  ctx.restore();
}
