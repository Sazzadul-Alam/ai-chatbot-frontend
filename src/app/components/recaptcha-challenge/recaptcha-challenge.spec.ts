import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RecaptchaChallenge } from './recaptcha-challenge';

describe('RecaptchaChallenge', () => {
  let component: RecaptchaChallenge;
  let fixture: ComponentFixture<RecaptchaChallenge>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecaptchaChallenge]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RecaptchaChallenge);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
