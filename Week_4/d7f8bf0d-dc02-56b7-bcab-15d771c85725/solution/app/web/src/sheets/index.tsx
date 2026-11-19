import './sheets.css'
import { useSelector } from '../state'
import { HistorySheet } from './history-sheet'
import { LayoutsSheet } from './layouts-sheet'
import { MembersSheet } from './members-sheet'
import { PacketsSheet } from './packets-sheet'
import { SessionsSheet } from './sessions-sheet'
import { StandardsSheet } from './standards-sheet'
import { TimetableSheet } from './timetable-sheet'
import { TrashSheet } from './trash-sheet'
import { VersionsSheet } from './versions-sheet'

export { DialogHost } from './dialogs'

export function SheetHost() {
  const sheet = useSelector(s => s.sheet)
  switch (sheet) {
    case 'layouts': return <LayoutsSheet />
    case 'versions': return <VersionsSheet />
    case 'timetable': return <TimetableSheet />
    case 'crew-packets': return <PacketsSheet />
    case 'members': return <MembersSheet />
    case 'standards': return <StandardsSheet />
    case 'history': return <HistorySheet />
    case 'trash': return <TrashSheet />
    case 'sessions': return <SessionsSheet />
    default: return null
  }
}
