export type RuleInput = {
  priority?: string | null;
  dueDate?: Date | null;
  needsAmi?: boolean;
  blocked?: boolean;
  lastMeaningfulActivity?: Date | null;
};

export function scoreRules(input: RuleInput, now = new Date()) {
  let importance = 0;
  let amiAttention = 0;
  const priority = input.priority?.toLowerCase();

  if (priority === 'urgent') importance += 25;
  if (priority === 'high') importance += 15;
  if (input.needsAmi) {
    amiAttention += 55;
    importance += 10;
  }
  if (input.blocked) importance += 15;

  if (input.dueDate) {
    const hours = (input.dueDate.getTime() - now.getTime()) / 36e5;
    if (hours < 0) {
      importance += 20;
      if (input.needsAmi) amiAttention += 20;
    } else if (hours <= 24) {
      importance += 15;
      if (input.needsAmi) amiAttention += 15;
    } else if (hours <= 72) {
      importance += 8;
    }
  }

  if (input.lastMeaningfulActivity && now.getTime() - input.lastMeaningfulActivity.getTime() > 72 * 36e5) {
    importance += 10;
  }

  if (input.blocked && input.needsAmi) amiAttention += 15;

  return {
    importance: Math.min(100, importance),
    amiAttention: Math.min(100, amiAttention)
  };
}
