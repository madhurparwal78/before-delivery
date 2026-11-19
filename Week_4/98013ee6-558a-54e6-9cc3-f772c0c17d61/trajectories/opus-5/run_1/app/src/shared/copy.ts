export const copy = {
  pins: (n: number): string => `${n} ${n === 1 ? 'pin' : 'pins'}`,
  followers: (n: number): string => `${n} ${n === 1 ? 'follower' : 'followers'}`,
  following: (n: number): string => `${n} following`,
  saves: (n: number): string => `${n} ${n === 1 ? 'save' : 'saves'}`,
  comments: (n: number): string => `${n} ${n === 1 ? 'comment' : 'comments'}`,
  reactions: (n: number): string => `${n} ${n === 1 ? 'reaction' : 'reactions'}`,
  selected: (n: number): string => `${n} ${n === 1 ? 'pin' : 'pins'} selected`,
  newPins: (n: number): string => `${n} new ${n === 1 ? 'pin' : 'pins'}`,
  showNewPins: (n: number): string => `Show ${n} new ${n === 1 ? 'pin' : 'pins'}`,
  viewing: (n: number): string => `${n} ${n === 1 ? 'person' : 'people'} viewing`,
  movedBulk: (n: number, board: string): string =>
    `${n} ${n === 1 ? 'pin' : 'pins'} moved to ${board}`,
  copiedBulk: (n: number, board: string): string =>
    `${n} ${n === 1 ? 'pin' : 'pins'} copied to ${board}`,
  deletedBulk: (n: number): string => `${n} ${n === 1 ? 'pin' : 'pins'} deleted`,
  moveDialog: (n: number): string => `Move ${n} ${n === 1 ? 'pin' : 'pins'}`,
  copyDialog: (n: number): string => `Copy ${n} ${n === 1 ? 'pin' : 'pins'}`,
  movedPin: (title: string, k: number, n: number): string =>
    `Moved ${title} to position ${k} of ${n}`,
  movedSection: (name: string, k: number, m: number): string =>
    `Moved section ${name} to position ${k} of ${m}`,
  groupCredit: (owners: string[]): string => {
    if (owners.length === 2) return `Saved by ${owners[0]} and ${owners[1]}`;
    return `Saved by ${owners[0]} and ${owners.length - 1} others`;
  },
  genericError: 'Something went wrong. Try again.',
  storageOutage: "Images can't be uploaded right now. Your draft is kept.",
  imageUnavailable: 'Image unavailable',
  emptyFeed: 'Follow people or boards to fill your feed.',
  emptyBoard: 'No pins yet',
  noPinsYet: 'No pins yet',
  deletedComment: 'This comment was deleted.',
  selectionCleared: 'Selection cleared',
  originalRemoved: 'Original removed',
} as const;

export function overLimit(used: number, max: number): string {
  return `${used - max} over the limit`;
}

export function counterText(used: number, max: number): string {
  return `${used} / ${max}`;
}
