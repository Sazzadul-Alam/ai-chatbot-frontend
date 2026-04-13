import { Injectable, ApplicationRef, createComponent, EnvironmentInjector } from '@angular/core';
import {ToastComponent} from './toast-component/toast-component';


@Injectable({ providedIn: 'root' })
export class ToastService {

  constructor(
    private appRef: ApplicationRef,
    private injector: EnvironmentInjector
  ) {}

  success(message: string, title: string = 'Success', duration:number): void {
    this.show(message, title, 'success', duration);
  }

  error(message: string, title: string = 'Error', duration: number = 4000): void {
    this.show(message, title, 'error', duration);
  }

  private show(message: string, title: string, type: 'success' | 'error', duration: number): void {
    const hostEl = document.createElement('div');
    document.body.appendChild(hostEl);

    const ref = createComponent(ToastComponent, {
      environmentInjector: this.injector,
      hostElement: hostEl,
    });

    ref.instance.message  = message;
    ref.instance.title    = title;
    ref.instance.type     = type;
    ref.instance.duration = duration;

    this.appRef.attachView(ref.hostView);

    setTimeout(() => {
      this.appRef.detachView(ref.hostView);
      ref.destroy();
      document.body.removeChild(hostEl);
    }, duration + 500); // +500 for fade-out animation
  }
}
