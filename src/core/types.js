import { PlayerController } from './brains/PlayerController.js';
import { ChaseAI } from './brains/ChaseAI.js';
// Giá trị mặc định THEO LOẠI. Prefab chỉ cần ghi đè những gì khác biệt.
export const TYPE_DEFAULTS = {
  player: { brain: PlayerController, stats: { team: 'player', maxHp: 100, speed: 5, jump: 9, radius: 0.5 } },
  enemy:  { brain: ChaseAI,          stats: { team: 'enemy',  maxHp: 30,  speed: 2.5, jump: 0, radius: 0.5, aggroRange: 14 } },
  // Thêm loại mới (mob trung lập, boss, npc...) ở đây
};
