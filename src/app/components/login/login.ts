import { Component, inject, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { BsModalRef, BsModalService } from 'ngx-bootstrap/modal';
import { ChatService } from '../../services/chat.service';
import { Registration } from '../registration/registration';
import { RecaptchaChallengeComponent } from '../recaptcha-challenge/recaptcha-challenge';
import {Router} from '@angular/router';

@Component({
  selector: 'app-login',
  imports: [FormsModule, CommonModule, RecaptchaChallengeComponent],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  userName: string = '';
  password: string = '';
  showPassword: boolean = false;
  isLoading: boolean = false;
  errorMessage: string = '';

  captchaVerified: boolean = false;
  captchaLoading: boolean = false;
  showChallenge: boolean = false;

  private chatService = inject(ChatService);
  private cdr = inject(ChangeDetectorRef);

  constructor(
    private modalService: BsModalService,
    private bsModalRef: BsModalRef,
    private registrationModalRef: BsModalRef,
    private router: Router,
  ) {}

  onCaptchaClick(): void {
    if (!this.captchaVerified) {
      this.showChallenge = true;
    }
  }

  onCaptchaVerified(): void {
    this.showChallenge = false;
    this.captchaLoading = true;
    setTimeout(() => {
      this.captchaLoading = false;
      this.captchaVerified = true;
      this.cdr.markForCheck();
    }, 1200);
  }

  onLogin(): void {
    if (!this.userName || !this.password) {
      this.errorMessage = 'Please fill in all fields.';
      return;
    }
    if (!this.captchaVerified) {
      this.errorMessage = 'Please complete the reCAPTCHA.';
      return;
    }

    this.errorMessage = '';
    this.isLoading = true;

    const formData = new FormData();
    formData.append('username', this.userName);
    formData.append('password', this.password);

    this.chatService.login(formData).subscribe({
      next: (res) => {
        const data = JSON.parse(res);

        const user={
          name:data.FullName,
          email:this.userName,
          accessToken:data.AccessToken,
          refreshToken:data.RefreshToken,
        };
        localStorage.setItem('user', JSON.stringify(user));
        localStorage.setItem('accessToken', data.AccessToken);
        localStorage.setItem('refreshToken', data.RefreshToken);
        this.isLoading = false;
        console.log('Login success:', res);
        this.bsModalRef.hide();
        window.location.reload();
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = 'Invalid username or password.';
        console.error('Login error:', err);
      }
    });
  }

  onForgotPassword(): void {
    // TODO: open forgot password modal or navigate
  }

  onSignUp(): void {
    this.bsModalRef.hide();
    this.registrationModalRef = this.modalService.show(Registration, {
      backdrop: 'static',
      keyboard: false,
      class: 'modal-dialog modal-dialog-centered modal-sm'
    });
    this.registrationModalRef.content.onRegistration.subscribe((res: any) => {
      console.log('Registered:', res);
    });
  }
  asGuest(): void {
    const guestData = {
      name: 'Guest User',
      type: 'guest',
      loggedInAt: new Date().toISOString(),
      isGuest: true,
      sessionId: 'guest_' + Date.now()
    };
    localStorage.setItem('user', JSON.stringify(guestData));
    window.location.reload();
  }
}
