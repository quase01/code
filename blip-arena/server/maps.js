'use strict';
/**
 * 맵 불러오기
 *
 * shared/maps/ 폴더의 *.json 파일을 서버 시작 시 전부 읽습니다.
 * 파일 이름이 맵 id가 됩니다. (예: shared/maps/arena.json → "arena")
 * 새 맵을 추가하려면 JSON 파일 하나만 만들고 서버를 재시작하면 로비 목록에 나타납니다.
 * 형식이 잘못된 맵은 경고를 출력하고 건너뜁니다. (형식 설명은 shared/world.js 상단)
 */
const fs = require('fs');
const path = require('path');
const World = require('../shared/world');

const MAP_DIR = path.join(__dirname, '..', 'shared', 'maps');

function loadMaps() {
  const maps = {};
  const files = fs.readdirSync(MAP_DIR).filter((f) => f.endsWith('.json')).sort();
  for (const file of files) {
    const id = path.basename(file, '.json');
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(MAP_DIR, file), 'utf8'));
    } catch (err) {
      console.warn(`[맵] ${file} 을(를) 읽지 못해 건너뜁니다: ${err.message}`);
      continue;
    }
    const errors = World.validateMap(data);
    if (errors.length) {
      console.warn(`[맵] ${file} 형식 오류로 건너뜁니다:\n  - ${errors.join('\n  - ')}`);
      continue;
    }
    data.name = data.name || id;
    maps[id] = data;
  }
  if (!Object.keys(maps).length) throw new Error('shared/maps 폴더에 사용할 수 있는 맵이 없습니다.');
  return maps;
}

module.exports = loadMaps();
