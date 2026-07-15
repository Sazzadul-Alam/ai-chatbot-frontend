import {ApplicationConfig, importProvidersFrom} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { routes } from './app.routes';
import {ModalModule} from 'ngx-bootstrap/modal';
import { RECAPTCHA_SETTINGS, RecaptchaSettings } from 'ng-recaptcha';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideHttpClient(withFetch()),
    importProvidersFrom(ModalModule.forRoot()),
    // Real Google reCAPTCHA v2. Site key comes from the environment; the dark
    // theme keeps it consistent with the app's UI. The token the widget returns
    // must be verified server-side with the matching secret key.
    {
      provide: RECAPTCHA_SETTINGS,
      useValue: { siteKey: environment.recaptchaSiteKey, theme: 'dark' } as RecaptchaSettings,
    },
  ]
};
