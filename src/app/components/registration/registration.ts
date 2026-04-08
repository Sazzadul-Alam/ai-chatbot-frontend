import { Component, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-registration',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './registration.html',
  styleUrl: './registration.css',
})
export class Registration {
  @Output() switchToLogin = new EventEmitter<void>();
  @Output() registered    = new EventEmitter<void>();

  userName        = '';
  email           = '';
  phone           = '';
  password        = '';
  confirmPassword = '';
  showPassword    = false;
  showConfirm     = false;
  isLoading       = false;
  errorMsg        = '';

  togglePassword(): void  { this.showPassword = !this.showPassword; }
  toggleConfirm(): void   { this.showConfirm  = !this.showConfirm;  }

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

    this.isLoading = true;

    // Simulate API call
    setTimeout(() => {
      this.isLoading = false;
      // const userData = {
      //   name: this.userName,
      //   email: this.email,
      //   phone: this.phone,
      //   type: 'registered',
      //   loggedInAt: new Date().toISOString(),
      //   isGuest: false,
      // };
      // localStorage.setItem('user', JSON.stringify(userData));

    }, 1200);
  }

  goToLogin(): void {
    this.switchToLogin.emit();
  }
}
