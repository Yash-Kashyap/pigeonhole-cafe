/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    owner?: import('./lib/owner/auth').OwnerSession;
  }
}
