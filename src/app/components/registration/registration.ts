import {
  Component,
  ChangeDetectorRef, OnInit, HostListener,
  ElementRef, ViewChild
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
  imports: [CommonModule, FormsModule], // ← removed NgxIntlTelInputModule
  templateUrl: './registration.html',
  styleUrl: './registration.css',
})
export class Registration implements OnInit {

  @ViewChild('flagTrigger') flagTriggerRef!: ElementRef;

  countryCodes:      any[] = [];
  filteredCountries: any[] = [];

  constructor(
    private modalService: BsModalService,
    private bsModalRef: BsModalRef,
    private chatService: ChatService,
    public verifyModalRef: BsModalRef,
    public loginModalRef: BsModalRef,
    private cdr: ChangeDetectorRef
  ) {}

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
  countryCode:    any;

  dropdownOpen  = false;
  searchTerm    = '';
  selectedIso = '';
  phoneNumberLimit:    any;

  ngOnInit(): void {
    this.loadCountryCodes();
    if (this.prefill) {
      this.userName = this.prefill.userName ?? '';
      this.email    = this.prefill.email    ?? '';
      this.phone    = this.prefill.phone    ?? '';
    }
  }

  getFlag(isoCode: string): string {
    if (!isoCode || isoCode.length < 2) return '🌐';
    const code = isoCode.trim().toUpperCase().slice(0, 2);
    return Array.from(code)
      .map(ch => String.fromCodePoint(0x1F1E6 - 65 + ch.charCodeAt(0)))
      .join('');
  }

  toggleDropdown(): void {
    this.dropdownOpen = !this.dropdownOpen;
    if (this.dropdownOpen) {
      this.searchTerm        = '';
      this.filteredCountries = [...this.countryCodes];
    }
  }

  onSearch(): void {
    const term = this.searchTerm.toLowerCase();
    this.filteredCountries = this.countryCodes.filter(c =>
      c.isoCodes.toLowerCase().includes(term) ||
      String(c.countryCode).includes(term)
    );
  }

  // selectCountry(c: any): void {
  //   this.countryCode  = c.countryCode;
  //   this.selectedFlag = this.getFlag(c.isoCodes);
  //   this.dropdownOpen = false;
  //   this.cdr.markForCheck();
  // }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: MouseEvent): void {
    if (this.flagTriggerRef &&
      !this.flagTriggerRef.nativeElement.contains(e.target)) {
      this.dropdownOpen = false;
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
    if (this.phoneNumberLimit && this.phone.length !== this.phoneNumberLimit) {
      this.errorMsg = `Phone number must be exactly ${this.phoneNumberLimit} digits.`;
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

    // ✅ Combine country code + local number
    const fullPhone = `+${this.countryCode}${this.phone}`;

    const registrationData = {
      name:    this.userName,
      email:   this.email,
      phone:   fullPhone,
      type:    'registered',
      isGuest: false,
    };

    const formData = new FormData();
    formData.append('name',        this.userName);
    formData.append('email',       this.email);
    formData.append('phoneNumber', fullPhone);  // ✅ sends +8801xxxxxxxxx
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
  //
  // loadCountryCodes(): void {
  //   this.chatService.getCountryCode().subscribe({
  //     next: (res: any) => {
  //       this.countryCodes      = res;
  //       this.filteredCountries = [...res];
  //
  //       const bd  = this.countryCodes.find(c => c.countryCode === '880');
  //       const def = bd ?? this.countryCodes[0];
  //       if (def) {
  //         this.countryCode  = def.countryCode;
  //         this.selectedFlag = this.getFlag(def.isoCodes);
  //       }
  //       this.cdr.markForCheck();
  //     },
  //     error: (err) => console.error('Failed to load country codes:', err)
  //   });
  // }
  getFlagClass(isoCode: string): string {
    if (!isoCode || isoCode.length < 2) return '';
    return `fi fi-${isoCode.trim().toLowerCase().slice(0, 2)}`;
  }
  // Update selectCountry():
  selectCountry(c: any): void {
    this.countryCode = c.countryCode;
    this.selectedIso = c.isoCodes;       // ← store ISO code, not emoji
    this.phoneNumberLimit = c.phoneNumberLimit;       // ← store ISO code, not emoji
    this.dropdownOpen = false;
    this.cdr.markForCheck();
  }
  // Update loadCountryCodes():
  loadCountryCodes(): void {
    this.chatService.getCountryCode().subscribe({
      next: (res: any) => {
        this.countryCodes      = res;
        this.filteredCountries = [...res];

        const bd  = this.countryCodes.find(c => c.countryCode === '880');
        const def = bd ?? this.countryCodes[0];
        if (def) {
          this.countryCode = def.countryCode;
          this.selectedIso = def.isoCodes;
          this.phoneNumberLimit = def.phoneNumberLimit;
        }
        this.cdr.markForCheck();
      },
      error: (err) => console.error('Failed to load country codes:', err)
    });
  }

  onPhoneInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const limit = this.phoneNumberLimit;
    if (limit && input.value.length > limit) {
      this.phone = input.value.slice(0, limit);
    }
  }
}
