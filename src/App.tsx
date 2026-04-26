import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import PDV from "./pages/PDV";
import Produtos from "./pages/Produtos";
import Lotes from "./pages/Lotes";
import Configuracoes from "./pages/Configuracoes";
import APrazo from "./pages/APrazo";
import Historico from "./pages/Historico";

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<PDV />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/produtos" element={<Produtos />} />
        <Route path="/lotes" element={<Lotes />} />
        <Route path="/aprazo" element={<APrazo />} />
        <Route path="/historico" element={<Historico />} />
        <Route path="/config" element={<Configuracoes />} />
      </Routes>
    </Layout>
  );
}

export default App;
