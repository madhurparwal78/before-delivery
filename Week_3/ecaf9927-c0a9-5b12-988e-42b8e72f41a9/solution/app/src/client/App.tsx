import { Shell } from './components/Shell';
import { SignIn } from './components/SignIn';
import { Workbench, useWorkbench } from './workbench';

function Screen() {
  const { member, booted } = useWorkbench();
  if (!booted) return null;
  return member ? <Shell /> : <SignIn />;
}

export function App() {
  return (
    <Workbench>
      <Screen />
    </Workbench>
  );
}
