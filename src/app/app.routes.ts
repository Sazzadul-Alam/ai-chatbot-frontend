import { Routes } from '@angular/router';
import { ChatComponent } from './components/chat/chat.component';
import {LandingPage} from './components/landing-page/landing-page';

export const routes: Routes = [
  { path: '', component: ChatComponent },
  { path: 'chat', component: ChatComponent }
];
