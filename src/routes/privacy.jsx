import {createFileRoute} from "@tanstack/react-router";
import LegalPage from "@/components/LegalPage";
export const Route=createFileRoute("/privacy")({head:()=>({meta:[{title:"Privacy Policy — VICEHUB"}]}),component:()=> <LegalPage slug="privacy" title="Privacy Policy"/>});
