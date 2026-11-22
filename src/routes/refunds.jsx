import {createFileRoute} from "@tanstack/react-router";
import LegalPage from "@/components/LegalPage";
export const Route=createFileRoute("/refunds")({head:()=>({meta:[{title:"Refund Policy — VICEHUB"}]}),component:()=> <LegalPage slug="refunds" title="Refund Policy"/>});
