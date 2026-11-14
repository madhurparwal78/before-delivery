import type { ShareAccess } from '../shared/domain.ts'
import { config } from './config.ts'
import { sendMail } from './smtp.ts'

export async function sendSignInCode(email: string, code: string, stopsAt: string): Promise<void> {
  await sendMail({
    to: email,
    subject: 'Your Joinery sign-in code',
    text: `Your Joinery sign-in code is ${code}.\nIt stops working at ${stopsAt}.\n`,
  })
}

export async function sendInvitation(args: {
  email: string
  ownerName: string
  projectName: string
  token: string
  access: ShareAccess
  stopsAt: string
}): Promise<void> {
  await sendMail({
    to: args.email,
    subject: `${args.ownerName} shared "${args.projectName}" on Joinery`,
    text: [
      `Open it here: ${config.publicUrl}/s/${args.token}`,
      `This link can ${args.access} the diagram.`,
      `It stops working at ${args.stopsAt}.`,
      '',
    ].join('\n'),
  })
}
