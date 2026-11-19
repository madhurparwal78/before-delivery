import { withCommas } from '../shared/format';

/** Every published string, character for character. */
export const S = {
  announce: {
    invitationSent: (name: string) => `Invitation sent to ${name}.`,
    invitationWithdrawn: 'Invitation withdrawn.',
    invitationIgnored: 'Invitation ignored.',
    connectedOnProfile: (name: string) => `You are now connected with ${name}. 1st degree.`,
    connectedElsewhere: (name: string) => `You are now connected with ${name}.`,
    connectionRemoved: 'Connection removed.',
    blocked: (name: string) => `You blocked ${name}.`,
    unblocked: (name: string) => `Unblocked ${name}.`,
    invitationFailed: 'Invitation not sent.',
    withdrewMany: (n: number) =>
      n === 1 ? 'Withdrew 1 invitation.' : `Withdrew ${n} invitations.`,
    connectionPathChanged: 'Connection path changed.',
    newPosts: (n: number) => (n === 1 ? '1 new post available' : `${n} new posts available`),
    postPublished: 'Post published.',
    postNotPublished: 'Post not published.',
    postUpdated: 'Post updated.',
    postDeleted: 'Post deleted.',
    postRemoved: 'Post removed.',
    reactionSet: (type: string) => `Reaction: ${type}`,
    reactionRemoved: 'Reaction removed',
    commentPosted: 'Comment posted.',
    commentDeleted: 'Comment deleted.',
    commentNotPosted: 'Comment not posted.',
    reposted: 'Reposted.',
    photoAttached: 'Photo attached.',
    newMessage: (name: string) => `New message from ${name}`,
    messageSent: 'Message sent.',
    messageNotSent: 'Message not sent.',
    resumeAttached: 'Resume attached.',
    applicationSubmitted: 'Application submitted.',
    applicationNotSubmitted: 'Application not submitted.',
    pickedUp: (name: string) => `Picked up ${name}`,
    movedTo: (name: string, label: string) => `Moved ${name} to ${label}`,
    moveCancelled: 'Move cancelled.',
    applicationStatus: (jobTitle: string, statusText: string) =>
      `Your application for ${jobTitle} is now: ${statusText}.`,
    jobSaved: 'Job saved.',
    jobUnsaved: 'Job removed from saved.',
    questionMoved: (position: number, total: number) =>
      `Question moved to position ${position} of ${total}.`,
    jobFieldSaved: (label: string) => `${label} saved.`,
    sectionSaved: 'Section saved.',
    endorsed: (skill: string) => `Endorsed ${skill}.`,
    endorsementRemoved: 'Endorsement removed.',
    visibilitySaved: 'Visibility saved.',
    skillMoved: (skill: string, position: number, total: number) =>
      `${skill} moved to position ${position} of ${total}.`,
    uploading: 'Uploading…',
  },
  alert: {
    cooldown: (name: string, date: string, time: string) =>
      `You withdrew an invitation to ${name}. You can invite them again on ${date} at ${time}.`,
    batchWithdrawRefused: (name: string) =>
      `${name}'s invitation is no longer pending. Nothing was withdrawn.`,
    weeklyLimit: (limit: number) =>
      `You've reached the weekly invitation limit of ${withCommas(limit)}.`,
    photoTooLarge: (limit: number) => `Photos can be up to ${withCommas(limit)} bytes.`,
    photoWrongType: 'Choose a JPEG or PNG image.',
    resumeWrongType: 'Upload a PDF file.',
    resumeTooLarge: (limit: number) => `Resumes can be up to ${withCommas(limit)} bytes.`,
    storageUnreachable: 'Uploads are unavailable right now. Try again later.',
    alreadyApplied: 'You already applied to this job.',
    jobClosedWhileApplying: 'This job stopped accepting applications.',
    sectionConflict: 'Someone changed this section since you opened it.',
    skillLimit: (limit: number) => `You can list up to ${withCommas(limit)} skills.`,
    featuredLimit: 'You can feature up to 3 skills.',
    featuredOrderConflict: "Your skills changed somewhere else. This order wasn't saved.",
    editWindowClosed: 'The edit window for this post has closed.',
    jobFieldConflict: (name: string) => `${name} changed this field while you were editing.`,
    questionsLocked: "Questions can't change after someone has applied.",
    tooManyQuestions: 'A job can have up to 10 questions.',
    wrongSignIn: "That email and password don't match.",
    unconfirmedSignIn: 'Confirm your email first. We sent you a code.',
    applicationAlreadyMoved: (label: string) => `This application already moved to ${label}.`,
    closesFormat: 'Use YYYY-MM-DD HH:MM.',
    somethingWrong: 'Something went wrong. Try again.',
  },
  empty: {
    feed: 'Your feed is empty.',
    inbox: 'No conversations yet.',
    notifications: 'No notifications yet.',
    invitations: 'No pending invitations.',
    savedJobs: 'No saved jobs yet.',
    applications: 'No applications yet.',
    blocked: "You haven't blocked anyone.",
    profileUnavailable: "This profile isn't available",
    postUnavailable: 'This post is no longer available.',
    unknownAddress: "We couldn't find that page.",
    searchFailed: "Search isn't working right now.",
  },
  placeholder: {
    connectionsOnly: (first: string) =>
      `${first} shares experience, education and skills with connections only.`,
    private: (first: string) => `${first} keeps this profile private.`,
    deletedComment: 'This comment was deleted.',
    messageRefusal: (name: string) => `You can message ${name} once you're connected.`,
  },
  search: {
    count: (n: number, query: string) =>
      n === 0 ? `No results for \u201C${query}\u201D` : n === 1 ? '1 result' : `${n} results`,
  },
  messaging: {
    offline: "You're offline. Messages will send when you reconnect.",
    waiting: 'Waiting to send',
    sending: 'Sending…',
    notSentNotConnected: "Not sent. You're no longer connected.",
    notSent: 'Not sent.',
    typing: (first: string) => `${first} is typing…`,
    seen: (time: string) => `Seen ${time}`,
  },
  jobs: {
    closed: 'No longer accepting applications',
  },
  editor: {
    onlyYou: 'Only you are editing',
    typingHere: (first: string) => `${first} is typing here`,
    savedNewVersion: (first: string) => `${first} saved a new version`,
    alsoEditing: (names: string[], total: number) => {
      if (total === 1) return `${names[0]} is also editing`;
      if (total === 2) return `${names[0]} and ${names[1]} are also editing`;
      return `${names[0]} and ${total - 1} others are also editing`;
    },
  },
};
