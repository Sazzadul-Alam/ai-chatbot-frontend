import {
  Component, Output, EventEmitter,
  ChangeDetectorRef, OnInit
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BsModalRef, BsModalService } from 'ngx-bootstrap/modal';
import { CheckMailVerfiy } from '../check-mail-verfiy/check-mail-verfiy';
import { Subject } from 'rxjs';
import { ChatService } from '../../services/chat.service';
import { Login } from '../login/login';

@Component({
  selector: 'app-registration',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './registration.html',
  styleUrl: './registration.css',
})
export class Registration implements OnInit {

  constructor(
    private modalService: BsModalService,
    private bsModalRef: BsModalRef,
    private chatService: ChatService,
    public verifyModalRef: BsModalRef,
    public loginModalRef: BsModalRef,
    private cdr: ChangeDetectorRef
  ) {}

  // populated by initialState when coming back from verify screen
  prefill?: { userName?: string; email?: string; phone?: string };

  onRegistration = new Subject<any>();

  userName        = '';
  email           = '';
  phone           = '';
  password        = '';
  confirmPassword = '';
  showPassword    = false;
  showConfirm     = false;
  isLoading       = false;
  errorMsg        = '';

  ngOnInit(): void {
    if (this.prefill) {
      this.userName = this.prefill.userName ?? '';
      this.email    = this.prefill.email    ?? '';
      this.phone    = this.prefill.phone    ?? '';
    }
  }

  togglePassword(): void { this.showPassword = !this.showPassword; }
  toggleConfirm(): void  { this.showConfirm  = !this.showConfirm;  }

  onSubmit(): void {
    this.errorMsg = '';

    if (!this.userName.trim() || !this.email.trim() || !this.phone.trim()
      || !this.password || !this.confirmPassword) {
      this.errorMsg = 'Please fill in all fields.';
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(this.email)) {
      this.errorMsg = 'Please enter a valid email address.';
      return;
    }

    if (this.password.length < 6) {
      this.errorMsg = 'Password must be at least 6 characters.';
      return;
    }

    if (this.password !== this.confirmPassword) {
      this.errorMsg = 'Passwords do not match.';
      return;
    }

    this.isLoading = true;   // ← was being immediately reset to false before, now fixed

    const registrationData = {
      name:  this.userName,
      email: this.email,
      phone: this.phone,
      type:  'registered',
      isGuest: false,
    };

    const formData = new FormData();
    formData.append('name',        this.userName);
    formData.append('email',       this.email);
    formData.append('phoneNumber', this.phone);
    formData.append('password',    this.password);

    this.chatService.registration(formData).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.verifyModalRef = this.modalService.show(CheckMailVerfiy, {
          initialState: { res: registrationData },
          backdrop: 'static', keyboard: false,
          class: 'modal-dialog modal-dialog-centered modal-sm'
        });
        this.onRegistration.next({ data: registrationData });
        this.bsModalRef.hide();
      },
      error: (err) => {
        this.isLoading = false;

        if (err.status === 409) {
          this.errorMsg = 'This email is already registered. Please log in instead.';
        } else if (err.status === 400) {
          this.errorMsg = err.error?.message || 'Invalid registration details.';
        } else if (err.status === 0) {
          this.errorMsg = 'Cannot reach the server. Please check your connection.';
        } else {
          this.errorMsg = err.error?.message || 'Something went wrong. Please try again.';
        }

        this.cdr.markForCheck();
      }
    });
  }

  goToLogin(): void {
    this.bsModalRef.hide();
    this.loginModalRef = this.modalService.show(Login, {
      backdrop: 'static', keyboard: false,
      class: 'modal-dialog modal-dialog-centered modal-sm'
    });
  }
}
