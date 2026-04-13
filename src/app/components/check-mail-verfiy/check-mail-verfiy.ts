import {
  Component, OnInit, OnDestroy, AfterViewInit,
  ViewChildren, QueryList, ElementRef,
  NgZone, ChangeDetectorRef, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { BsModalRef, BsModalService } from 'ngx-bootstrap/modal';
import { ChatService } from '../../services/chat.service';
import { Login } from '../login/login';
import {ToastService} from '../../shared/toast';

@Component({
  selector: 'app-check-mail-verfiy',
  imports: [CommonModule],
  templateUrl: './check-mail-verfiy.html',
  styleUrl: './check-mail-verfiy.css',
})
export class CheckMailVerfiy implements OnInit, AfterViewInit, OnDestroy {

  private ngZone      = inject(NgZone);
  private cdr         = inject(ChangeDetectorRef);
  private bsModalRef  = inject(BsModalRef);
  private chatService = inject(ChatService);
  private toastr = inject(ToastService);        // ← add

  res: any = {};
  timeLeft: number = 120;
  interval: any;
  displayTime: string = '02:00';

  @ViewChildren('otpInput') otpInputs!: QueryList<ElementRef>;

  constructor(
    private modalService: BsModalService,
    public loginModalRef: BsModalRef) {
  }

  ngOnInit() {
    this.startTimer();
  }

  ngAfterViewInit() {
    this.cdr.detectChanges();
  }

  startTimer() {
    clearInterval(this.interval);
    this.updateDisplay();

    this.ngZone.runOutsideAngular(() => {
      this.interval = setInterval(() => {
        if (this.timeLeft > 0) {
          this.timeLeft--;
          this.updateDisplay();
          this.cdr.detectChanges();
        } else {
          clearInterval(this.interval);
          this.cdr.detectChanges();
        }
      }, 1000);
    });
  }

  updateDisplay() {
    const minutes = Math.floor(this.timeLeft / 60);
    const seconds = this.timeLeft % 60;
    this.displayTime = `${this.format(minutes)}:${this.format(seconds)}`;
  }

  format(value: number): string {
    return value < 10 ? '0' + value : value.toString();
  }

  onInput(event: Event, index: number) {
    const input = event.target as HTMLInputElement;
    const value = input.value;

    if (!/^\d$/.test(value)) {
      input.value = '';
      return;
    }

    const inputs = this.otpInputs?.toArray();
    if (inputs && value && index < inputs.length - 1) {
      inputs[index + 1].nativeElement.focus();
    }
  }

  onKeyDown(event: KeyboardEvent, index: number) {
    if (!this.otpInputs) return;

    const inputs = this.otpInputs.toArray();
    if (event.key === 'Backspace' && !(event.target as HTMLInputElement).value && index > 0) {
      inputs[index - 1].nativeElement.focus();
    }
  }

  resendCode() {
    this.timeLeft = 120;
    this.startTimer();
    const formData = new FormData();
    formData.append('loginId',        this.res.email);
    this.chatService.resendCode(formData).subscribe({
      next: (res) => {

      }
      });
  }

  activateAcc() {
    if (!this.otpInputs) return;

    const otp = this.otpInputs.toArray()
      .map(el => el.nativeElement.value)
      .join('');

    if (otp.length < 4) {
      this.toastr.error(
        '',
        'Please enter all 4 digits', 4000);
      console.warn('Please enter all 4 digits');
      return;
    }

    const formData = new FormData();
    formData.append('loginId', this.res?.email);
    formData.append('otp', otp);

    this.chatService.activate(formData).subscribe({
      next: (res) => {
        // ── Success toast ───────────────────────────────────────────────
        this.toastr.success(
          'You have successfully signed up. Please login to continue',
          'Signed Up', 4000);
        // ────────────────────────────────────────────────────────────────

        this.bsModalRef.hide();

        setTimeout(() => {
          this.loginModalRef = this.modalService.show(Login, {
            backdrop: 'static', keyboard: false,
            class: 'modal-dialog modal-dialog-centered modal-sm'
          });
        }, 400);
      },
      error: (err) => {
        this.toastr.error(
          '',
          'OTP is not correct', 4000);
        console.error('Activation error:', err)
      }
    });
  }

  ngOnDestroy() {
    clearInterval(this.interval);
  }

  back() {
    this.bsModalRef.hide();
    const Registration = require('../registration/registration').Registration;
    this.modalService.show(Registration, {
      initialState: {
        prefill: {
          userName: this.res?.name,
          email:    this.res?.email,
          phone:    this.res?.phone,
        }
      },
      backdrop: 'static',
      keyboard: false,
      class: 'modal-dialog modal-dialog-centered modal-sm'
    });
  }
}
