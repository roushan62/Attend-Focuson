/** Simple collision-safe unique ids, e.g. att_lx2k9a_7fq3 */
export function newId(prefix: string): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${t}${r}`;
}
