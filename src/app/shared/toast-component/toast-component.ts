import {
  Component, Input, OnInit, OnDestroy,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-toast-component',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './toast-component.html',
  styles: [`
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');

    .toast-wrapper {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 99999;
      animation: toastIn 0.35s cubic-bezier(0.21, 1.02, 0.73, 1) forwards;
      font-family: 'DM Sans', sans-serif;
    }

    .toast-wrapper.toast-hide {
      animation: toastOut 0.4s ease forwards;
    }

    @keyframes toastIn {
      from { opacity: 0; transform: translateX(110%); }
      to   { opacity: 1; transform: translateX(0);    }
    }

    @keyframes toastOut {
      from { opacity: 1; transform: translateX(0);    }
      to   { opacity: 0; transform: translateX(110%); }
    }

    .toast-box {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      min-width: 300px;
      max-width: 380px;
      padding: 14px 16px 18px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.08);
      background: #12151f;
      box-shadow: 0 8px 32px rgba(0,0,0,0.45);
      overflow: hidden;
    }

    .toast-success .toast-icon { color: #4ade80; }
    .toast-error   .toast-icon { color: #f87171; }

    .toast-icon {
      flex-shrink: 0;
      margin-top: 1px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: rgba(255,255,255,0.05);
    }

    .toast-body {
      flex: 1;
      min-width: 0;
    }

    .toast-title {
      margin: 0 0 2px;
      font-size: 13.5px;
      font-weight: 600;
      color: #ffffff;
    }

    .toast-message {
      margin: 0;
      font-size: 12.5px;
      color: rgba(255,255,255,0.55);
      line-height: 1.5;
    }

    /* Progress bar */
    .toast-progress {
      position: absolute;
      bottom: 0;
      left: 0;
      height: 3px;
      width: 100%;
      border-radius: 0 0 12px 12px;
      animation: progress linear forwards;
      transform-origin: left;
    }

    .toast-success .toast-progress { background: #4ade80; }
    .toast-error   .toast-progress { background: #f87171; }

    @keyframes progress {
      from { transform: scaleX(1); }
      to   { transform: scaleX(0); }
    }
  `]
})
export class ToastComponent implements OnInit, OnDestroy {
  @Input() message  = '';
  @Input() title    = '';
  @Input() type: 'success' | 'error' = 'success';
  @Input() duration = 4000;

  hiding = false;
  private hideTimer: any;

  ngOnInit(): void {
    // Start fade-out just before the host destroys this component
    this.hideTimer = setTimeout(() => {
      this.hiding = true;
    }, this.duration - 400);
  }

  ngOnDestroy(): void {
    clearTimeout(this.hideTimer);
  }
}
