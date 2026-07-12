import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Shell } from "@/components/Shell";
import { Home } from "@/routes/Home";
import { Create } from "@/routes/Create";
import { Challenge } from "@/routes/Challenge";

export default function App() {
  return (
    <BrowserRouter>
      <Shell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/create" element={<Create />} />
          <Route path="/c/:market" element={<Challenge />} />
        </Routes>
      </Shell>
    </BrowserRouter>
  );
}
