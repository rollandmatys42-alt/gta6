import {createFileRoute} from "@tanstack/react-router";
import LegalPage from "@/components/LegalPage";
export const Route=createFileRoute("/copyright")({head:()=>({meta:[{title:"Copyright & Takedown — VICEHUB"}]}),component:()=> <LegalPage slug="copyright" title="Copyright & Takedown"/>});
