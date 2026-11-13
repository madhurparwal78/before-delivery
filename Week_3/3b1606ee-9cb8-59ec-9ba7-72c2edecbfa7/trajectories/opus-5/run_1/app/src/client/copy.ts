/** Every published string, exactly as the brief words it. */

export const copy = {
  availability: {
    available: 'Available',
    taken: 'Taken',
    length: 'Use 3 to 32 characters.',
    characters: 'Use only lowercase letters, numbers, underscores and dots.',
    first_character: 'Start with a letter.',
    last_character: "Don't end with a dot.",
  },
  recoveryWrongGroup: "That group doesn't match your recovery code.",
  displayNameEmpty: 'Enter a display name.',
  photoNotStored: "Your photo couldn't be saved. You can add it in Settings later.",
  restoreFailed: "That username and recovery code don't match.",
  restoreTooMany: 'Too many tries. Wait a minute and try again.',
  signedOut: 'This account was restored in another browser, so this browser is signed out.',
  lookupNotFound: 'No one with that username.',
  conversationNotFound: "We couldn't find that letter.",
  tooLong: 'Letters can be up to 8,000 characters.',
  wrongPhotoType: 'Choose a JPEG, PNG or WebP photo.',
  letterRefused: "This letter couldn't be sent.",
  attachmentCorrupted: 'Attachment corrupted',
  attachmentUnavailable: "This attachment can't be opened right now.",
  outage: "Photos and files can't be sent or opened right now. Letters still go through.",
  somethingWrong: 'Something went wrong. Try again.',
  usernameSame: "That's already your username.",
  deletedForEveryoneReceived: 'This letter was deleted.',
  deletedForEveryoneSent: 'You deleted this letter.',
  connecting: 'Connecting...',
  letterDeleted: 'Letter deleted.',
  letterRestored: 'Letter restored.',
  uploadFinished: 'Upload finished.',
  uploadFailed: "Couldn't upload. Your letter wasn't sent.",
  empty: {
    chats: 'No letters yet. Find someone by their exact username.',
    requests: 'No letter requests.',
    contacts: 'No contacts yet.',
    blocked: "You haven't blocked anyone.",
    conversation: 'Nothing written yet. Your first letter is sealed before it leaves this page.',
  },
  postmark: {
    sending: 'Sending',
    sent: 'Sent',
    delivered: 'Delivered',
    read: 'Read',
    failed: 'Failed',
    returned: 'Returned: not collected in 30 days',
    received: 'Received',
  },
} as const;

export const say = {
  found: (username: string) => `Found ${username}.`,
  fileOverCap: (limit: string) => `This file is larger than ${limit} and can't be sent.`,
  posted: (name: string) => `Sent. Held for ${name} until they collect it.`,
  delivered: (name: string, time: string) => `Delivered to ${name} at ${time}.`,
  read: (name: string, time: string) => `Read by ${name} at ${time}.`,
  returned: (name: string) => `Your letter to ${name} was returned: not collected in 30 days.`,
  newLetter: (name: string) => `New letter from ${name}.`,
  updating: (count: number) => `Updating... ${count} ${count === 1 ? 'letter' : 'letters'}`,
  keyChangeStub: (name: string) =>
    `${name}'s seal number has changed. Letters to ${name} are paused until you accept the new seal number.`,
  keyChangeRow: (name: string) => `${name}'s seal number changed.`,
  blockBody: (name: string) =>
    `${name} won't be able to reach you. Letters they send while blocked are never delivered.`,
  blockedConversation: (name: string) => `You blocked ${name}.`,
  usernameCooldown: (date: string) => `You can change your username again on ${date}.`,
  usernameChanged: (username: string) => `Your username is now ${username}.`,
  requestsLink: (count: number) => `Letter requests (${count})`,
  toastNameAndLetter: (name: string, firstLine: string) => `${name}: ${firstLine}`,
  photoAlt: (name: string) => `Photo from ${name}`,
  ownPhotoAlt: () => 'Your photo',
  download: (fileName: string) => `Download ${fileName}`,
  blockDialogTitle: (name: string) => `Block ${name}?`,
  unblockButton: (username: string) => `Unblock ${username}`,
  group: (position: number) => `Group ${position}`,
};

/** The size cap in megabytes, rounded down to one decimal place. */
export function megabytes(bytes: number): string {
  return `${(Math.floor((bytes / 1_048_576) * 10) / 10).toFixed(1)} MB`;
}

export const availabilityCopy = (reason: string | null, available: boolean): string => {
  if (available) return copy.availability.available;
  switch (reason) {
    case 'taken':
      return copy.availability.taken;
    case 'length':
      return copy.availability.length;
    case 'characters':
      return copy.availability.characters;
    case 'first_character':
      return copy.availability.first_character;
    case 'last_character':
      return copy.availability.last_character;
    default:
      return copy.availability.taken;
  }
};
