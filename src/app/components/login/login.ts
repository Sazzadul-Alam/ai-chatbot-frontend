import { Component, inject, ChangeDetectorRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { BsModalRef, BsModalService } from 'ngx-bootstrap/modal';
import { ChatService } from '../../services/chat.service';
import { Registration } from '../registration/registration';
import { RecaptchaModule } from 'ng-recaptcha';
import {Router} from '@angular/router';
import {ToastService} from '../../shared/toast';

@Component({
  selector: 'app-login',
  imports: [FormsModule, CommonModule, RecaptchaModule],
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
  captchaToken: string | null = null;

  private chatService = inject(ChatService);
  private cdr = inject(ChangeDetectorRef);
  private toastr = inject(ToastService);

  constructor(
    private modalService: BsModalService,
    private bsModalRef: BsModalRef,
    private registrationModalRef: BsModalRef,
    private router: Router,
  ) {}

  // Fired by the real Google reCAPTCHA widget. `token` is null when the captcha
  // expires or errors; a non-null token means the user passed the challenge.
  onCaptchaResolved(token: string | null): void {
    this.captchaToken = token;
    this.captchaVerified = !!token;
    if (token) this.errorMessage = '';
    this.cdr.markForCheck();
  }

  onLogin(): void {
    if (!this.userName || !this.password) {
      this.errorMessage = 'Please fill in all fields.';
      return;
    }
    if (!this.captchaVerified || !this.captchaToken) {
      this.errorMessage = 'Please complete the reCAPTCHA.';
      return;
    }

    this.errorMessage = '';
    this.isLoading = true;

    const formData = new FormData();
    formData.append('username', this.userName);
    formData.append('password', this.password);
    // Send the reCAPTCHA token so the backend can verify it with the secret key.
    formData.append('recaptchaToken', this.captchaToken);

    this.chatService.login(formData).subscribe({
      next: (res) => {
        const data = JSON.parse(res);

        const user = {
          name:         data.FullName,
          email:        this.userName,
          accessToken:  data.AccessToken,
          refreshToken: data.RefreshToken,
        };
        localStorage.setItem('user',         JSON.stringify(user));
        localStorage.setItem('type',         'Active User');
        localStorage.setItem('accessToken',  data.AccessToken);
        localStorage.setItem('refreshToken', data.RefreshToken);

        this.isLoading = false;
        this.bsModalRef.hide();
        window.location.reload();
      },
      error: (err) => {
        this.isLoading = false;
        this.cdr.markForCheck();
        this.toastr.error('Invalid username or password.', 'Login Failed');  // ← toast
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
