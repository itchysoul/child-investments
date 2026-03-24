import { Navigate, Route, Routes } from 'react-router-dom';
import BankApp from './App';
import LogicFinalApp from './LogicFinalApp';

export default function RootApp() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/bank" replace />} />
      <Route path="/bank/*" element={<BankApp />} />
      <Route path="/logic-final/*" element={<LogicFinalApp />} />
      <Route path="*" element={<Navigate to="/logic-final" replace />} />
    </Routes>
  );
}
