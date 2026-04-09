import {Component, OnInit} from '@angular/core';
import {NgIf} from '@angular/common';
import {Router} from '@angular/router';
import {BsModalRef, BsModalService} from 'ngx-bootstrap/modal';
import {Subject} from 'rxjs';
import {Login} from '../login/login';

@Component({
  selector: 'app-landing-page',
  templateUrl: './landing-page.html',
  styleUrl: './landing-page.css',
})
export class LandingPage implements OnInit{
  private isBrowser= false;
  showModal: boolean=true;
  onClose = new Subject<any>();
  constructor(private router: Router
              ,private modalService: BsModalService
              ,public bsModalRef: BsModalRef
              ,public loginModalRef: BsModalRef) {
  }

  ngOnInit(): void {

    const user = localStorage.getItem('user');
    if(user!=null && user!=''){
      this.showModal = false;
      // this.onGuest()
    }
  }

  onGuest() {
    const guestData = {
      name: 'Guest User',
      type: 'guest',
      loggedInAt: new Date().toISOString(),
      isGuest: true,
      sessionId: 'guest_' + Date.now()
    };
    localStorage.setItem('user', JSON.stringify(guestData));
    this.showModal = false;
    // this.router.navigate(['/chat'])
    this.onClose.next({type:"guest",data:guestData});
    this.bsModalRef.hide()
  }

  onSignUp() {
    const guestData = {};
    localStorage.setItem('user', JSON.stringify(guestData));
    this.showModal = false;
    // this.router.navigate(['/chat'])
    this.onClose.next({type:"registration",data:guestData});
    this.bsModalRef.hide()
  }

  onSignIn() {
    this.bsModalRef.hide();
    this.loginModalRef = this.modalService.show(Login, {
      backdrop: 'static', keyboard: false,
      class: 'modal-dialog modal-dialog-centered modal-sm'
    });
  }

}
