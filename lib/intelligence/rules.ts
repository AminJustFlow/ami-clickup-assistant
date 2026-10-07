export type RuleInput = { listType: 'AMI'|'NOTIFICATION'|'OTHER'; priority?: string|null; dueDate?: Date|null; needsAmi?: boolean; blocked?: boolean; lastMeaningfulActivity?: Date|null };
export function scoreRules(input: RuleInput, now = new Date()) {
  let importance = 0, amiAttention = 0;
  const p = input.priority?.toLowerCase();
  if (p === 'urgent') importance += 25;
  if (p === 'high') importance += 15;
  if (input.listType === 'AMI') amiAttention += 25;
  if (input.needsAmi) amiAttention += 40;
  if (input.blocked) importance += 15;
  if (input.dueDate) {
    const hours = (input.dueDate.getTime() - now.getTime()) / 36e5;
    if (hours < 0) importance += 20;
    else if (hours <= 24) importance += 15;
  }
  if (input.lastMeaningfulActivity && now.getTime() - input.lastMeaningfulActivity.getTime() > 72 * 36e5) importance += 10;
  return { importance: Math.min(100, importance), amiAttention: Math.min(100, amiAttention) };
}
