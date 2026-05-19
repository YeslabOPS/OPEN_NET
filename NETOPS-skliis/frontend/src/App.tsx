import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import DeviceInfo from './pages/DeviceInfo';
import DeviceBackup from './pages/DeviceBackup';
import ConfigDiff from './pages/ConfigDiff';
import InspectReport from './pages/InspectReport';
import InteractiveCLI from './pages/InteractiveCLI';
import AIAssistant from './pages/AIAssistant';
import SkillManager from './pages/SkillManager';
// import NetworkTopology from './pages/NetworkTopology';
import TaskScheduler from './pages/TaskScheduler';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/devices" replace />} />
        <Route path="devices" element={<DeviceInfo />} />
        <Route path="backup" element={<DeviceBackup />} />
        <Route path="diff" element={<ConfigDiff />} />
        <Route path="inspect" element={<InspectReport />} />
        <Route path="cli" element={<InteractiveCLI />} />
        <Route path="ai" element={<AIAssistant />} />
        <Route path="skills" element={<SkillManager />} />
        {/* <Route path="topology" element={<NetworkTopology />} /> */}
        <Route path="scheduler" element={<TaskScheduler />} />
      </Route>
    </Routes>
  );
}

export default App;
