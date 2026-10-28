// One fixed room; pose changes expose only the visible character, not furniture.
export const SCENE_SIZE = Object.freeze({ width: 1586, height: 992 });
const legs = 'M 975 631 C 1027 625 1144 633 1237 662 L 1245 716 C 1230 766 1211 790 1168 800 L 1060 796 C 1043 861 1023 935 1011 995 L 697 995 C 750 914 796 835 838 757 C 871 698 912 646 975 631 Z';
export const SCENE_MASKS = Object.freeze({
  work: 'M 1018 124 L 1037 111 L 1022 113 L 1053 98 Q 1100 73 1204 76 L 1225 57 L 1244 91 L 1286 58 L 1272 110 Q 1318 127 1332 200 L 1338 274 Q 1356 345 1401 384 Q 1447 424 1428 492 L 1405 538 L 1369 568 Q 1354 612 1295 630 L 1239 668 L 1169 654 L 1118 618 L 1128 585 Q 1036 578 1002 565 L 940 572 L 921 552 L 918 524 L 941 511 L 948 435 Q 968 369 985 303 L 990 241 Q 979 166 1018 124 Z',
  cup: 'M 1140 129 Q 1183 103 1261 107 L 1319 111 L 1337 93 L 1351 131 Q 1390 147 1405 205 L 1413 282 Q 1424 330 1436 378 L 1445 449 L 1431 505 L 1406 555 Q 1407 596 1358 611 L 1270 620 L 1236 678 L 1132 656 L 1125 607 L 1096 583 L 1052 571 Q 1008 566 1017 525 L 1028 491 L 1046 442 L 1072 386 L 1089 334 L 1103 285 L 1107 230 Q 1092 170 1140 129 Z',
  thinking: 'M 985 139 L 1028 109 Q 1070 79 1149 89 L 1164 72 L 1183 106 L 1233 84 L 1227 112 Q 1267 131 1287 198 L 1294 273 Q 1329 340 1391 382 Q 1435 431 1421 479 L 1397 528 L 1369 556 L 1348 590 Q 1326 623 1259 644 L 1226 672 L 1168 662 L 1150 651 L 1049 648 L 1024 642 L 1067 622 L 1134 600 L 1135 580 L 1062 570 L 983 570 L 944 560 Q 917 547 924 517 L 936 476 L 975 413 L 986 363 L 989 328 L 988 301 L 994 275 L 987 246 L 977 217 Q 962 173 985 139 Z',
  window: 'M 1107 113 Q 1166 76 1249 81 L 1266 65 L 1281 97 L 1309 84 L 1325 106 Q 1369 132 1377 204 L 1384 281 Q 1402 333 1426 387 L 1438 449 L 1425 500 L 1397 547 L 1391 586 L 1352 621 L 1300 644 L 1281 649 L 1260 628 L 1255 609 L 1238 651 L 1189 675 L 1147 671 L 1129 649 L 1097 648 L 1051 615 L 1020 575 L 975 566 L 975 527 L 996 482 L 1019 420 L 1060 361 L 1098 327 L 1111 288 L 1127 271 L 1111 259 L 1125 242 L 1110 224 Q 1088 174 1107 113 Z',
  attention: 'M 1065 127 L 1082 118 L 1059 110 L 1092 113 Q 1143 90 1204 96 L 1223 80 L 1243 99 L 1284 77 L 1297 103 Q 1348 115 1362 196 L 1368 283 L 1386 341 L 1408 407 L 1406 477 L 1384 527 L 1368 552 L 1356 594 L 1328 638 L 1240 661 L 1209 686 L 1160 680 L 1128 657 L 1081 637 L 1067 610 L 1094 590 L 1025 584 L 1002 551 L 957 545 L 943 520 L 956 466 L 978 409 L 1016 345 L 1043 281 Q 1032 213 1046 163 Z',
});

const layers = new WeakMap();
function characterLayer(person, pose) {
  let poses=layers.get(person);if(!poses){poses=new Map();layers.set(person,poses);}if(poses.has(pose))return poses.get(pose);
  const layer=document.createElement('canvas'),mask=document.createElement('canvas');layer.width=mask.width=1586;layer.height=mask.height=992;
  const matte=mask.getContext('2d'),path=new Path2D(SCENE_MASKS[pose]);
  // Small registration tolerance keeps fine hair, while a soft edge avoids
  // exposing a hard polygon of the source's slightly different background.
  matte.fillStyle=matte.strokeStyle='#fff';matte.lineWidth=12;matte.lineJoin='round';matte.filter='blur(3px)';matte.fill(path);matte.stroke(path);
  const ctx=layer.getContext('2d');ctx.drawImage(person,0,0,1586,992);ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0);
  poses.set(pose,layer);return layer;
}

export function drawSceneFrame(context, room, person, pose, { width = 1586, height = 992, legReference = person } = {}) {
  if (!Object.hasOwn(SCENE_MASKS, pose)) throw new Error('Unknown scene pose');
  context.clearRect(0, 0, width, height);
  context.drawImage(room, 0, 0, width, height);
  context.save(); context.scale(width / 1586, height / 992);
  context.clip(new Path2D(legs));
  context.drawImage(legReference, 0, 0, 1586, 992);
  context.restore();
  context.drawImage(characterLayer(person,pose),0,0,width,height);
  if (pose === 'cup') {
    // The held mug leaves its saucer empty; this is the only moving room prop.
    context.save(); context.scale(width / 1586, height / 992);
    context.clip(new Path2D('M 1485 650 L 1586 650 L 1586 795 L 1480 795 Z'));
    context.drawImage(person, 0, 0, 1586, 992); context.restore();
  }
}
