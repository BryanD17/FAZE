export function toggle(list: number[], id: number) {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}
