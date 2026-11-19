import { parseDecimal } from '../util';

export const OPERATORS = [
  'equals',
  'not equals',
  'contains',
  'greater than',
  'less than',
  'is empty',
  'is not empty',
] as const;

export type Operator = (typeof OPERATORS)[number];

export function isOperator(value: string): value is Operator {
  return (OPERATORS as readonly string[]).includes(value);
}

export function needsRight(operator: string): boolean {
  return operator !== 'is empty' && operator !== 'is not empty';
}

/**
 * Compares two resolved texts: as numbers when both parse as finite decimals,
 * otherwise as case-sensitive strings by code unit.
 */
export function evaluateCondition(operator: string, left: string, right: string): boolean {
  if (operator === 'is empty') return left.trim() === '';
  if (operator === 'is not empty') return left.trim() !== '';
  if (operator === 'contains') return left.includes(right);
  const leftNumber = parseDecimal(left);
  const rightNumber = parseDecimal(right);
  const numeric = leftNumber !== null && rightNumber !== null;
  switch (operator) {
    case 'equals':
      return numeric ? leftNumber === rightNumber : left === right;
    case 'not equals':
      return numeric ? leftNumber !== rightNumber : left !== right;
    case 'greater than':
      return numeric ? (leftNumber as number) > (rightNumber as number) : left > right;
    case 'less than':
      return numeric ? (leftNumber as number) < (rightNumber as number) : left < right;
    default:
      return false;
  }
}
