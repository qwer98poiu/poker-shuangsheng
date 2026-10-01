/**
 * 等级显示：2-10 保持数字，11-14 显示为 J/Q/K/A。
 * 竞技场里的「打几」与牌点同序：11=J、12=Q、13=K、14=A。
 */
export function levelLabel(level: number): string {
  return ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[level] ?? String(level);
}
