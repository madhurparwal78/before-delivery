import { startInstance } from './instance'
import { startSupervisor } from './supervisor'

if (process.env.GANDYBOARD_ROLE === 'instance') {
  startInstance().catch(error => {
    console.error(error)
    process.exit(1)
  })
} else {
  startSupervisor()
}
