import heart from 'lucide-static/icons/heart.svg';
import chevronsUpDown from 'lucide-static/icons/chevrons-up-down.svg';
import messageCircle from 'lucide-static/icons/message-circle.svg';
import arrowUp from 'lucide-static/icons/arrow-up.svg';
import arrowDown from 'lucide-static/icons/arrow-down.svg';
import fileText from 'lucide-static/icons/file-text.svg';
import file from 'lucide-static/icons/file.svg';

export const icons = {
  heart,
  votes: chevronsUpDown,
  comments: messageCircle,
  voteUp: arrowUp,
  voteDown: arrowDown,
  fileText,
  file,
};

export const fileIcon = (contentType: string): string =>
  contentType.startsWith('text/') || contentType === 'application/pdf' ? icons.fileText : icons.file;
