const down = new Set(), pressed = new Set();
if (typeof window !== 'undefined') {
  addEventListener('keydown', e => { if (!e.repeat) pressed.add(e.code); down.add(e.code); if (e.code === 'Space') e.preventDefault(); });
  addEventListener('keyup', e => down.delete(e.code));
}
export const Input = {
  down: c => down.has(c),
  pressed: c => pressed.has(c),   // true đúng 1 frame khi vừa bấm
  endFrame() { pressed.clear(); },
};
