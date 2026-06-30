import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource-variable/vazirmatn";
import "./index.css";
import "react-multi-date-picker/styles/layouts/mobile.css";
import { setAuthTokenGetter } from "@workspace/api-client-react";

setAuthTokenGetter(() => localStorage.getItem("clinic_auth_token"));

createRoot(document.getElementById("root")!).render(<App />);
