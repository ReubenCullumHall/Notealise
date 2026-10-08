import { describe, expect, it } from 'vitest'
import { createSwipeDetector, type SwipeStep } from './spaceSwipe'

// Events are [deltaX, deltaY, ms]. A real flick is dozens of events 16ms apart whose size
// rises and then dies away — the part after the fingers lift is momentum, and it is why the
// detector must move ONCE per gesture. These are built to look like that, not like one
// tidy event.
type Ev = [number, number, number]

/** A flick: quick rise, exponential tail. `sign` 1 = fingers going left (next space). */
function flick(sign: 1 | -1, peak: number, from = 0, n = 40, upShare = 0.08): Ev[] {
  const out: Ev[] = []
  for (let i = 0; i < n; i++) {
    const size = peak * Math.min(1, (i + 1) / 3) * Math.exp(-i / 12)
    out.push([sign * size, (i % 2 ? 1 : -1) * size * upShare, from + i * 16])
  }
  return out
}

/** Up/down scrolling by someone whose fingers also wander sideways. */
function scrollDown(from = 0, n = 50, wander = 0.12): Ev[] {
  const out: Ev[] = []
  for (let i = 0; i < n; i++) {
    const size = 40 * Math.exp(-i / 20)
    out.push([(i % 3 ? 1 : -1) * size * wander, size, from + i * 16])
  }
  return out
}

// Recorded on Reuben's MacBook Air trackpad (macOS 27), 2026-10-08: two fingers swiped sideways in a
// small test window — slow strokes, left and right without lifting. Five strokes of about 61, 153,
// 132, 255 and 258 px, each 3-10x as far sideways as it was up/down. Real events, not tidy ones.
const REAL_SWIPES: Ev[] = [
  [1, 0, 0], [2, -1, 23], [4, -1, 43], [4, -1, 56], [5, -1, 73], [5, -1, 88], [4, -1, 105], [5, -1, 122],
  [4, -1, 139], [3, -1, 156], [2, -1, 173], [2, -1, 189], [1, -1, 206], [1, -1, 223], [1, -1, 240], [1, -1, 256],
  [2, -1, 273], [2, -1, 289], [2, -1, 306], [2, -1, 322], [2, -1, 339], [2, 0, 355], [1, 0, 373], [1, 0, 390],
  [1, 0, 406], [1, 0, 422], [-1, 0, 605], [-2, 0, 623], [-2, 0, 640], [-5, 1, 671], [-3, 1, 689], [-3, 1, 722],
  [-6, 2, 739], [-3, 1, 756], [-3, 1, 772], [-3, 1, 790], [-3, 1, 806], [-3, 1, 821], [-3, 1, 839], [-3, 1, 856],
  [-6, 2, 889], [-4, 1, 906], [-4, 1, 922], [-7, 2, 956], [-4, 1, 972], [-3, 1, 989], [-3, 1, 1007], [-3, 1, 1022],
  [-3, 1, 1040], [-3, 1, 1056], [-4, 1, 1072], [-5, 1, 1090], [-5, 1, 1106], [-12, 2, 1138], [-6, 1, 1156], [-6, 1, 1172],
  [-5, 1, 1190], [-5, 1, 1206], [-4, 1, 1223], [-4, 1, 1239], [-4, 1, 1256], [-3, 1, 1271], [-3, 1, 1289], [-2, 1, 1306],
  [-1, 1, 1323], [-1, 0, 1356], [1, 0, 1406], [2, 0, 1422], [2, 0, 1440], [3, 0, 1456], [4, 0, 1472], [4, -1, 1489],
  [4, -1, 1506], [6, -1, 1521], [7, -1, 1538], [8, -1, 1555], [8, -1, 1572], [14, -2, 1606], [7, -1, 1623], [8, -1, 1639],
  [10, -2, 1655], [9, -2, 1672], [9, -1, 1689], [6, -1, 1706], [5, -1, 1722], [9, -2, 1757], [5, -2, 1789], [1, -1, 1806],
  [-1, -4, 1839], [1, 0, 2554], [1, -1, 2556], [9, -1, 2572], [12, -1, 2589], [11, -1, 2606], [9, -1, 2623], [14, -1, 2639],
  [12, -1, 2655], [10, -1, 2673], [12, -1, 2689], [9, -1, 2705], [9, -1, 2723], [6, -1, 2742], [6, -1, 2756], [6, 0, 2772],
  [5, -1, 2789], [4, -1, 2805], [4, -1, 2821], [4, -1, 2839], [3, -1, 2855], [2, 0, 2873], [2, -1, 2889], [1, 0, 2922],
  [1, 0, 2939], [1, -1, 2989], [1, -1, 3007], [3, -1, 3021], [5, -1, 3039], [7, -1, 3056], [10, -2, 3072], [10, -2, 3089],
  [10, -2, 3106], [11, -2, 3122], [10, -2, 3140], [9, -2, 3156], [8, -2, 3172], [6, -2, 3188], [5, -2, 3206], [3, -2, 3223],
  [2, -1, 3239], [1, -1, 3256], [0, -1, 3290], [0, -1, 3306], [-2, -1, 3323], [-7, 0, 3339], [-13, 1, 3356], [-20, 2, 3372],
  [-25, 2, 3389], [-30, 2, 3406], [-31, 2, 3423], [-22, 2, 3439], [-27, 2, 3456], [-21, 1, 3473], [-14, 1, 3489], [-13, 1, 3506],
  [-10, 1, 3523], [-7, 1, 3539], [-6, 1, 3556], [-4, 1, 3573], [-3, 1, 3589], [-1, 1, 3606], [-1, 1, 3623], [-1, 1, 3639],
]

// Recorded on Reuben's MacBook Air trackpad (macOS 27), 2026-10-08, in the real app: two fingers swiped
// sideways as fast and as often as he could — five pushes left, three right, a 1.6s pause, one left and
// three right (13 in all; fast ones peak at 30-130 px per event). It never pauses for even 180ms, so the
// only thing between one push and the next is a dip of an event or two. This is the stream the first two
// versions of the detector turned into 3 moves instead of 13.
const REAL_CHAIN: Ev[] = [
  [1, 0, 0], [1, 1, 0], [7, 1, 17], [11, 1, 33], [15, 1, 50], [15, -1, 64], [11, -2, 81], [12, -1, 99],
  [17, 0, 102], [19, 0, 119], [20, 0, 135], [19, 0, 152], [19, 0, 169], [18, 0, 185], [21, 0, 202], [19, 0, 219],
  [18, 0, 235], [16, 0, 252], [15, 0, 269], [14, 0, 285], [13, 0, 302], [12, 0, 319], [10, 0, 335], [9, 0, 352],
  [9, 0, 373], [8, 0, 385], [7, 0, 402], [7, 0, 419], [6, 0, 435], [6, 0, 452], [5, 0, 469], [5, 0, 485],
  [5, 0, 502], [4, 0, 519], [4, 0, 535], [4, 0, 552], [3, 0, 569], [3, 0, 585], [3, 0, 602], [3, 0, 618],
  [2, 0, 635], [2, 0, 652], [2, 0, 668], [2, 0, 685], [1, 0, 702], [1, 0, 719], [1, 0, 735], [1, 0, 752],
  [1, 0, 769], [1, 0, 785], [1, 0, 819], [1, 0, 835], [1, 0, 869], [-1, 0, 999], [-5, 1, 1018], [-9, 2, 1032],
  [-11, 2, 1049], [-19, 2, 1067], [-32, 0, 1082], [-36, 0, 1098], [-37, 0, 1117], [-37, 0, 1135], [-37, 0, 1151], [-35, 0, 1166],
  [-39, 0, 1184], [-37, 0, 1201], [-35, 0, 1217], [-32, 0, 1232], [-29, 0, 1250], [-26, 0, 1267], [-24, 0, 1285], [-22, 0, 1299],
  [-20, 0, 1310], [-19, 0, 1332], [-17, 0, 1349], [-16, 0, 1367], [-14, 0, 1384], [-13, 0, 1400], [-12, 0, 1417], [-11, 0, 1434],
  [-10, 0, 1449], [-9, 0, 1466], [-8, 0, 1482], [-8, 0, 1501], [-7, 0, 1516], [-6, 0, 1534], [-6, 0, 1549], [-5, 0, 1566],
  [-5, 0, 1584], [-5, 0, 1601], [-4, 0, 1617], [-4, 0, 1634], [-4, 0, 1650], [-3, 0, 1666], [-3, 0, 1683], [-1, 0, 1733],
  [-7, 1, 1750], [-11, 1, 1766], [-14, 0, 1784], [-18, -2, 1798], [-28, 0, 1807], [-30, 0, 1824], [-32, 0, 1840], [-32, 0, 1857],
  [-31, 0, 1874], [-30, 0, 1891], [-34, 0, 1907], [-32, 0, 1923], [-30, 0, 1940], [-27, 0, 1957], [-24, 0, 1974], [-22, 0, 1990],
  [-20, 0, 2007], [-19, 0, 2024], [-17, 0, 2041], [-16, 0, 2057], [-14, 0, 2074], [-13, 0, 2091], [-12, 0, 2106], [-11, 0, 2124],
  [-10, 0, 2140], [-9, 0, 2157], [-8, 0, 2174], [-8, 0, 2191], [-7, 0, 2207], [-7, 0, 2224], [-6, 0, 2241], [-6, 0, 2257],
  [-5, 0, 2274], [-5, 0, 2290], [-5, 0, 2307], [-4, 0, 2323], [-4, 0, 2340], [-4, 0, 2357], [-1, 0, 2434], [-10, 2, 2450],
  [-14, 2, 2468], [-26, 1, 2484], [-50, -2, 2515], [-17, -1, 2531], [-30, 0, 2536], [-34, 0, 2553], [-36, 0, 2570], [-36, 0, 2586],
  [-35, 0, 2603], [-34, 0, 2619], [-39, 0, 2636], [-37, 0, 2653], [-35, 0, 2670], [-32, 0, 2686], [-29, 0, 2703], [-26, 0, 2720],
  [-24, 0, 2736], [-22, 0, 2753], [-20, 0, 2770], [-19, 0, 2786], [-17, 0, 2803], [-16, 0, 2820], [-14, 0, 2836], [-13, 0, 2853],
  [-12, 0, 2870], [-11, 0, 2886], [-10, 0, 2903], [-9, 0, 2919], [-8, 0, 2936], [-8, 0, 2953], [-7, 0, 2970], [-6, 0, 2986],
  [-1, 0, 3049], [-4, 1, 3066], [-13, 2, 3082], [-28, 1, 3100], [-58, -1, 3116], [-52, -3, 3132], [-44, -2, 3149], [-82, 0, 3151],
  [-94, 0, 3167], [-96, 0, 3184], [-93, 0, 3200], [-91, 0, 3217], [-87, 0, 3234], [-88, 0, 3251], [-84, 0, 3267], [-79, 0, 3284],
  [-74, 0, 3301], [-70, 0, 3317], [-64, 0, 3334], [-60, 0, 3350], [-57, 0, 3367], [-53, 0, 3384], [-49, 0, 3401], [-45, 0, 3417],
  [-41, 0, 3433], [-39, 0, 3451], [-35, 0, 3467], [-33, 0, 3484], [-30, 0, 3502], [-28, 0, 3518], [-24, 0, 3535], [-22, 0, 3551],
  [-21, 0, 3577], [-19, 0, 3584], [-17, 0, 3601], [-16, 0, 3617], [-14, 0, 3634], [-13, 0, 3651], [-12, 0, 3667], [-11, 0, 3684],
  [-10, 0, 3701], [-1, 0, 3748], [-6, 1, 3764], [-22, 3, 3781], [-46, 3, 3799], [-85, 1, 3817], [-122, -4, 3834], [-80, -4, 3848],
  [-45, -6, 3866], [-118, 0, 3882], [-127, 0, 3898], [-127, 0, 3915], [-124, 0, 3933], [-118, 0, 3953], [-112, 0, 3967], [-107, 0, 3984],
  [-101, 0, 4000], [-97, 0, 4017], [-91, 0, 4034], [-87, 0, 4049], [-82, 0, 4065], [-77, 0, 4083], [-74, 0, 4102], [-68, 0, 4115],
  [-64, 0, 4133], [-60, 0, 4150], [-56, 0, 4167], [-51, 0, 4184], [3, 0, 4250], [1, -1, 4250], [29, -1, 4264], [68, -3, 4283],
  [89, -7, 4298], [70, -9, 4316], [64, -10, 4336], [108, 0, 4339], [117, 0, 4356], [117, 0, 4372], [115, 0, 4389], [110, 0, 4406],
  [105, 0, 4422], [100, 0, 4439], [96, 0, 4456], [92, 0, 4472], [87, 0, 4489], [82, 0, 4506], [77, 0, 4522], [72, 0, 4539],
  [68, 0, 4556], [63, 0, 4574], [59, 0, 4589], [3, 0, 4632], [15, 1, 4648], [27, 0, 4666], [61, -3, 4682], [91, -6, 4698],
  [75, -8, 4714], [65, -10, 4731], [112, 0, 4740], [121, 0, 4757], [121, 0, 4774], [117, 0, 4790], [112, 0, 4807], [107, 0, 4824],
  [103, 0, 4839], [97, 0, 4857], [93, 0, 4874], [89, 0, 4890], [84, 0, 4907], [79, 0, 4924], [74, 0, 4940], [70, 0, 4956],
  [64, 0, 4974], [7, 0, 5033], [17, 1, 5048], [39, 1, 5065], [79, -4, 5082], [85, -6, 5098], [58, -8, 5116], [51, -6, 5132],
  [100, 0, 5134], [109, 0, 5150], [110, 0, 5167], [107, 0, 5183], [103, 0, 5200], [99, 0, 5217], [96, 0, 5234], [92, 0, 5250],
  [87, 0, 5267], [82, 0, 5284], [77, 0, 5301], [74, 0, 5316], [68, 0, 5334], [-1, 0, 6917], [-5, 0, 6934], [-10, 0, 6949],
  [-19, -1, 6966], [-35, -1, 6982], [-44, -1, 6999], [-40, -1, 7016], [-40, -1, 7034], [-25, -1, 7050], [-52, 0, 7059], [-60, 0, 7076],
  [-63, 0, 7093], [-63, 0, 7109], [-61, 0, 7126], [-59, 0, 7142], [-61, 0, 7159], [-58, 0, 7176], [-55, 0, 7193], [-51, 0, 7209],
  [-47, 0, 7225], [1, 0, 7267], [11, -1, 7283], [26, -2, 7299], [40, -2, 7315], [67, -4, 7334], [65, -5, 7349], [55, -6, 7367],
  [44, -6, 7384], [87, 0, 7387], [97, 0, 7404], [97, 0, 7420], [94, 0, 7437], [91, 0, 7454], [88, 0, 7470], [88, 0, 7487],
  [84, 0, 7504], [79, 0, 7520], [74, 0, 7536], [70, 0, 7554], [64, 0, 7570], [60, 0, 7587], [57, 0, 7604], [53, 0, 7620],
  [49, 0, 7637], [45, 0, 7654], [41, 0, 7670], [39, 0, 7687], [35, 0, 7704], [33, 0, 7720], [30, 0, 7737], [28, 0, 7754],
  [24, 0, 7770], [22, 0, 7787], [21, 0, 7804], [19, 0, 7820], [17, 0, 7837], [16, 0, 7854], [14, 0, 7871], [13, 0, 7886],
  [12, 0, 7904], [5, 0, 7950], [8, -1, 7966], [27, -3, 7984], [50, -8, 7999], [88, -18, 8017], [84, -22, 8032], [62, -23, 8049],
  [55, -19, 8067], [103, -29, 8067], [113, -32, 8083], [113, -33, 8100], [111, -33, 8117], [106, -34, 8134], [101, -32, 8151], [99, -36, 8167],
  [93, -35, 8184], [89, -32, 8200], [84, -29, 8219], [79, -26, 8234], [75, -24, 8250], [70, -22, 8268], [66, -20, 8283], [61, -19, 8300],
  [57, -17, 8316], [53, -16, 8334], [49, -14, 8350], [2, 0, 8398], [3, -2, 8417], [12, -3, 8432], [27, -8, 8450], [48, -19, 8466],
  [62, -26, 8483], [45, -22, 8499], [31, -17, 8516], [22, -11, 8532], [54, -24, 8542], [63, -28, 8559], [65, -29, 8576], [65, -28, 8593],
  [64, -28, 8609], [61, -27, 8626], [64, -30, 8642], [61, -30, 8659], [57, -27, 8676], [53, -24, 8693], [49, -22, 8709], [45, -20, 8726],
  [43, -19, 8743],
]

function run(events: Ev[], make = createSwipeDetector, over: (i: number) => boolean = () => false): SwipeStep[] {
  const feed = make()
  return events.map(([dx, dy, t], i) => feed(dx, dy, t, over(i))).filter((s) => s !== null)
}
const last = (e: Ev[]): number => e[e.length - 1][2]

describe('createSwipeDetector', () => {
  it('moves one space for one flick, however long its momentum tail runs', () => {
    expect(run(flick(1, 60))).toEqual([1])
    expect(run(flick(-1, 60))).toEqual([-1])
  })

  it('a hard flick is still one space, not several', () => {
    // 3x the travel of a normal one — would be a handful of thresholds if it counted per tail.
    expect(run(flick(1, 180))).toEqual([1])
  })

  it('a slow drag counts once it has gone far enough, and only once', () => {
    const drag: Ev[] = Array.from({ length: 60 }, (_, i) => [5, 0.5, i * 16] as Ev)
    expect(run(drag)).toEqual([1])
  })

  it('ordinary up/down scrolling does nothing, even with the fingers wandering sideways', () => {
    expect(run(scrollDown())).toEqual([])
    expect(run(scrollDown(0, 50, 0.3))).toEqual([]) // a clumsy scroller
  })

  it('a diagonal movement does nothing', () => {
    const diagonal: Ev[] = Array.from({ length: 30 }, (_, i) => [20, 20, i * 16] as Ev)
    expect(run(diagonal)).toEqual([])
  })

  it('a short twitch does nothing', () => {
    expect(run([[25, 1, 0], [15, 0, 16], [10, 0, 32]])).toEqual([])
  })

  it('a swipe that turns into up/down scrolling before it gets far is taken back', () => {
    const turn: Ev[] = [[22, 2, 0], [15, 1, 16], ...Array.from({ length: 25 }, (_, i) => [3, 30, 32 + i * 16] as Ev)]
    expect(run(turn)).toEqual([])
  })

  it('pauses start a fresh count — two small movements do not add up', () => {
    expect(run([[40, 0, 0], [40, 0, 400]])).toEqual([])
  })

  it('two flicks with a pause between are two moves', () => {
    const a = flick(1, 60)
    expect(run([...a, ...flick(1, 60, last(a) + 300)])).toEqual([1, 1])
  })

  it('swiping back straight after a flick, while its tail is still running, is its own move', () => {
    // The first flick's tail is still arriving when the fingers reverse.
    const first = flick(1, 60, 0, 25)
    const back = flick(-1, 60, last(first) + 16, 30)
    expect(run([...first, ...back])).toEqual([1, -1])
  })

  it('stutters the other way inside a long swipe do not fire it a second time', () => {
    // A long steady swipe that stutters back by a few px every third event: each stutter is
    // followed by more of the swipe, so none of them is the fingers coming back.
    const swipe: Ev[] = Array.from({ length: 60 }, (_, i) => [i % 3 === 2 ? -8 : 25, 0.5, i * 16] as Ev)
    expect(run(swipe)).toEqual([1])
  })

  it('up/down scrolling right after a flick does not move anything', () => {
    const a = flick(1, 60)
    expect(run([...a, ...scrollDown(last(a) + 300)])).toEqual([1])
  })

  it('a swipe over something that scrolls sideways never moves a space', () => {
    expect(run(flick(1, 60), createSwipeDetector, () => true)).toEqual([])
  })

  it('...and neither does the rest of that movement, when only SOME of its events land on the scroller', () => {
    // The scroller moves under the pointer, so every third event lands on something else (a tab's icon,
    // the gap between tabs). The ones that do not are still part of the same movement.
    expect(run(flick(1, 60), createSwipeDetector, (i) => i % 3 !== 0)).toEqual([])
    // ...even when the very first events are not over it at all, as long as it gets to the scroller
    // before the swipe is long enough.
    expect(run(flick(1, 60), createSwipeDetector, (i) => i > 0 && i < 40)).toEqual([])
  })

  it('one event over a scroller is enough: the rest of that movement is not a swipe', () => {
    // Only the first event touches the scroller; the 60px a swipe needs would otherwise be there by the
    // second. (An exemption that comes after the swipe has already moved a space is too late, by design.)
    expect(run(flick(1, 60), createSwipeDetector, (i) => i === 0)).toEqual([])
  })

  it('a swipe straight after a scroller has stopped moving counts again', () => {
    const over: Ev[] = flick(1, 60)
    const after = flick(1, 60, last(over) + 300)
    expect(run([...over, ...after], createSwipeDetector, (i) => i < over.length)).toEqual([1])
  })

  it('a fresh detector starts clean (no state shared between instances)', () => {
    const a = createSwipeDetector()
    const b = createSwipeDetector()
    for (const [dx, dy, t] of flick(1, 60)) a(dx, dy, t)
    expect(b(40, 0, 0)).toBeNull()
  })

  it('wiggling sideways back and forth does not add up to a swipe', () => {
    // Lots of sideways movement, none of it going anywhere: it never travels 100px one way.
    const wiggle: Ev[] = Array.from({ length: 60 }, (_, i) => [(i % 2 ? -1 : 1) * 30, 1, i * 16] as Ev)
    expect(run(wiggle)).toEqual([])
  })

  it('a swipe back needs no more travel than a swipe forward', () => {
    // 80px back after a flick, as soon as its tail ends. The first 40px only show that the fingers have
    // turned round — they still count towards the swipe, or it would take 100px to get the same move.
    const first = flick(1, 60, 0, 25)
    const gap = last(first) + 20
    const back: Ev[] = Array.from({ length: 8 }, (_, i) => [-10, 0.5, gap + i * 16] as Ev)
    expect(run([...first, ...back])).toEqual([1, -1])
  })

  it('quick swipes the same way, one straight after the next, each move a space', () => {
    // What quick swiping actually is: a push, its momentum dying away, and then — with no pause — the next
    // push, which begins with the movement all but stopped (here a single 1px event) and builds again.
    const push = [6, 22, 46, 85, 122, 80, 62, 50, 40, 32, 26, 20, 16, 12, 9, 7, 5, 4, 3, 2, 1]
    const chain: Ev[] = Array.from({ length: 5 }, (_, k) => push.map((dx, i) => [dx, 0.5, (k * push.length + i) * 16] as Ev)).flat()
    expect(run(chain)).toEqual([1, 1, 1, 1, 1])
    // ...and the same going the other way.
    expect(run(chain.map(([dx, dy, t]): Ev => [-dx, dy, t]))).toEqual([-1, -1, -1, -1, -1])
  })

  it('...and a push that starts before the last one has dipped at all is still its own move once it does', () => {
    // The last push is still at 14px per event when the fingers go again — the dip is to 3px for one event.
    const a = [12, 40, 90, 70, 50, 38, 28, 21, 16, 14]
    const b = [3, 20, 60, 100, 70, 50, 36, 26, 18, 12, 9, 6, 4, 3]
    const chain: Ev[] = [...a, ...b].map((dx, i) => [dx, 0.5, i * 16] as Ev)
    expect(run(chain)).toEqual([1, 1])
  })

  it('real two-finger swipes from a trackpad: every push long enough moves a space', () => {
    // Six pushes: 61px forward, 153px back, 132px forward, a flick forward (~150px) that dies to 1px for
    // about 0.1s and then goes again (~105px, "the 255px stroke" — really two), and 258px back. Each is a
    // move now that a swipe fires at 60px (it took 100px, and a slow stroke of 153px made you wait half
    // a second before anything happened).
    expect(run(REAL_SWIPES)).toEqual([1, -1, 1, 1, 1, -1])
  })

  it("Reuben's fast chained swiping: every one of the 13 pushes moves a space", () => {
    // Five pushes left, three right, (pause), one left, three right. The earlier detectors moved on 3 of them.
    expect(run(REAL_CHAIN)).toEqual([1, -1, -1, -1, -1, -1, 1, 1, 1, -1, 1, 1, 1])
  })

  it('the next swipe the SAME way, straight on from the tail of the last, is its own move', () => {
    // The tail dies away to ~1px, then — with no pause — the fingers go again. Lifting hands over to
    // momentum, touching down cancels it: nothing separates the two but the shape. (Version one
    // swallowed this: spaces 1->2 worked, 2->3 never did.)
    const first = flick(1, 60, 0, 48)
    const second: Ev[] = [1, 2, 4, 8, 12, 14, 12, 10, 8, 6, 5].map((dx, i) => [dx, 0.5, last(first) + 16 * (i + 1)] as Ev)
    expect(run([...first, ...second])).toEqual([1, 1])
  })

  it('...even when the lull before it is only up/down blips', () => {
    // The first swipe's own tail is cut off while it is still moving (3px), so the only stillness is
    // the blips — sideways movement of nothing, up/down movement of a pixel.
    const first = flick(1, 60, 0, 36)
    const lull: Ev[] = Array.from({ length: 5 }, (_, i) => [0, 1, last(first) + 16 * (i + 1)] as Ev)
    const second: Ev[] = [4, 9, 13, 14, 12, 9, 7].map((dx, i) => [dx, 0.5, last(lull) + 16 * (i + 1)] as Ev)
    expect(run([...first, ...lull, ...second])).toEqual([1, 1])
  })

  it('a long drawn-out tail of 1-4px events never fires again', () => {
    const first = flick(1, 60, 0, 48)
    const wobble = [1, 1, 2, 1, 3, 1, 1, 4, 2, 1]
    const tail: Ev[] = Array.from({ length: 150 }, (_, i) => [wobble[i % wobble.length], 0, last(first) + 16 * (i + 1)] as Ev)
    expect(run([...first, ...tail])).toEqual([1])
  })

  it('a push whose speed wobbles but never falls to a quarter of its fastest stays one swipe', () => {
    const wobble = [40, 25, 45, 30, 50, 35, 42, 28, 48, 33, 44, 30, 40, 26, 36]
    const swipe: Ev[] = wobble.map((dx, i) => [dx, 0.5, i * 16] as Ev)
    expect(run(swipe)).toEqual([1])
  })

  it('...and one that dips to just over a quarter of its fastest and recovers is still one swipe', () => {
    const swipe: Ev[] = [10, 30, 60, 55, 17, 55, 58, 50, 40, 30, 22, 16, 12, 9].map((dx, i) => [dx, 0.5, i * 16] as Ev)
    expect(run(swipe)).toEqual([1])
  })

  it('a hard first event does not make the next push harder to spot', () => {
    // The first swipe moves a space on one huge event (100px), then dies away to 8px, and the next push
    // builds from there. It is the 100, not the 30 that follows it, that sets how deep that dip is.
    const speeds = [100, 30, 12, 8, 26, 60, 80, 60, 40, 25]
    expect(run(speeds.map((dx, i) => [dx, 0.5, i * 16] as Ev))).toEqual([1, 1])
  })

  it('a push that goes straight past the last one\'s fastest still counts', () => {
    // The dip is to 1px, and the next push opens at 30px — faster than anything in the last push (22px).
    const speeds = [4, 14, 22, 22, 18, 12, 6, 3, 1, 30, 60, 80, 60, 40, 25]
    expect(run(speeds.map((dx, i) => [dx, 0.5, i * 16] as Ev))).toEqual([1, 1])
  })

  it('a swipe that speeds up again after a shallow slow-down is still one swipe', () => {
    // It moves a space at 20px, eases to 8 (not nearly a stop: well over a quarter of 20), then really gets
    // going at 40 and runs down from there. Each earlier slow-down must not count against the later, faster peak.
    const speeds = [10, 15, 15, 20, 15, 8, 40, 32, 28, 24, 20, 16, 12, 9, 6]
    expect(run(speeds.map((dx, i) => [dx, 0.5, i * 16] as Ev))).toEqual([1])
  })

  it('a long steady swipe with a little jitter stays one swipe', () => {
    // Never nearly stops, so it is never "the next swipe" — however much it wobbles in speed.
    const steady: Ev[] = Array.from({ length: 80 }, (_, i) => [i % 4 === 3 ? 16 : 10, 0.5, i * 16] as Ev)
    expect(run(steady)).toEqual([1])
  })
})
