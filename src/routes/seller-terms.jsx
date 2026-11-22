import {createFileRoute} from "@tanstack/react-router";
import LegalPage from "@/components/LegalPage";
export const Route=createFileRoute("/seller-terms")({head:()=>({meta:[{title:"Creator Seller Terms — VICEHUB"}]}),component:()=> <LegalPage slug="seller-terms" title="Creator Seller Terms"/>});
