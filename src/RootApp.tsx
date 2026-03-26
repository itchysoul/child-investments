import { Navigate, Route, Routes } from 'react-router-dom';
import BankApp from './App';
import LogicFinalArcadeApp from './LogicFinalArcadeApp';

export default function RootApp() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/bank" replace />} />
      <Route path="/bank/*" element={<BankApp />} />
      <Route path="/logic-final/*" element={<LogicFinalArcadeApp />} />
      <Route path="*" element={<Navigate to="/logic-final" replace />} />
    </Routes>
  );
}
