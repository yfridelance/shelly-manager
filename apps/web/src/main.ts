import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { defineKern } from './app/core/kern';

// Kern web components (kern-*) and the remembered theme, before the first render.
defineKern();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
